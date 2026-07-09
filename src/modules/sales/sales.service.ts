import { Injectable, HttpException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import type { SalesChatMessageDto, SalesChatDto, SaveLeadDto } from './dto/sales-chat.dto'

const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000
function iranDate(): string {
  return new Date(Date.now() + IRAN_OFFSET_MS).toISOString().slice(0, 10)
}

const SALES_SYSTEM_PROMPT = `تو دستیار فروش هوشمند نیوو هستی. نیوو یک سرویس هوش مصنوعی ایرانی است که دسترسی راحت و پرداخت ریالی ارائه می‌دهد.

## قوانین مطلق — هرگز نقض نکن:
1. فقط درباره نیوو، پلن‌ها، و کاربردهای هوش مصنوعی صحبت کن
2. اگر کاربر سوال فنی پرسید، کمک درسی خواست، متن نوشت، یا کد خواست، بگو: "این کارها بعد از اشتراک برات انجام می‌دم 😊 اول بذار بگم چطور کمکت می‌کنم"
3. رقبا (ChatGPT مستقیم، Claude و...) را نام نبر یا مقایسه نکن
4. قیمت‌ها را دقیق بگو — نه بالاتر، نه پایین‌تر
5. حداکثر ۱۵ پیام رد و بدل کن — بعد حتماً به ثبت‌نام هدایت کن
6. یک سوال در هر پیام — نه بیشتر
7. از ایموجی‌های مناسب استفاده کن ولی زیاده‌روی نکن

## جریان مکالمه:
- مرحله ۱ (پیام ۱-۳): کشف — شغل، سن، کارهای روزانه
- مرحله ۲ (پیام ۴-۶): درد — چالش اصلی، وقت تلف‌شده
- مرحله ۳ (پیام ۷-۱۱): ارزش — ۳-۵ use case شخصی‌سازی‌شده برای این کاربر خاص
- مرحله ۴ (پیام ۱۲-۱۵): توصیه یک پلن مشخص با دلیل + دعوت به ثبت‌نام

## پلن‌ها:
- رایگان: ۵ پیام در روز، مدل GPT-4o mini، بدون هزینه — برای تست اولیه
- اکو: ۵۰ پیام در روز، GPT-4o mini، ۱۹۹,۰۰۰ تومان ماهانه — برای استفاده روزانه متوسط
- پلاس: نامحدود، GPT-4o و GPT-4 Turbo (قوی‌ترین مدل‌ها)، ۴۹۹,۰۰۰ تومان ماهانه — برای استفاده حرفه‌ای و روزانه سنگین

## لحن و سبک:
- صمیمی، مثل یه دوست متخصص که دلسوزانه کمک می‌کند
- پیام‌های کوتاه — حداکثر ۳-۴ جمله
- فارسی محاوره‌ای و ساده — نه رسمی
- وقتی use case می‌دهی: مشخص و قابل تصور باش، نه کلی`

@Injectable()
export class SalesService {
  private readonly provider

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    this.provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey: this.config.get<string>('LIARA_API_KEY')!,
    })
  }

  async chat(dto: SalesChatDto, ip: string): Promise<{ reply: string; isDone: boolean; recommendedPlan?: string }> {
    // rate limit: 30 requests per hour per IP
    const rlKey = `sales:rl:${ip}:${iranDate()}`
    const count = await this.redis.incr(rlKey)
    if (count === 1) await this.redis.expire(rlKey, 3600)
    if (count > 30) throw new HttpException('تعداد درخواست بیش از حد مجاز است', 429)

    const messages = dto.messages.slice(-14)  // keep last 14 to stay within context
    const isDone = messages.length >= 14

    let text: string
    try {
      const result = await generateText({
        model: this.provider('openai/gpt-4o-mini'),
        system: SALES_SYSTEM_PROMPT,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        maxOutputTokens: 400,
      })
      text = result.text
    } catch {
      return {
        reply: 'سرویس هوش مصنوعی در حال حاضر در دسترس نیست. چند دقیقه دیگر دوباره امتحان کن 🙏',
        isDone: false,
      }
    }

    const recommendedPlan = this.extractPlan(text)

    return { reply: text, isDone, ...(recommendedPlan ? { recommendedPlan } : {}) }
  }

  async saveLead(dto: SaveLeadDto): Promise<{ id: string }> {
    const base = {
      ...(dto.sessionId   !== undefined && { sessionId: dto.sessionId }),
      ...(dto.phone       !== undefined && { phone: dto.phone }),
      ...(dto.name        !== undefined && { name: dto.name }),
      ...(dto.age         !== undefined && { age: dto.age }),
      ...(dto.city        !== undefined && { city: dto.city }),
      ...(dto.jobTitle    !== undefined && { jobTitle: dto.jobTitle }),
      ...(dto.interests   !== undefined && { interests: dto.interests }),
      ...(dto.chatHistory !== undefined && { chatHistory: dto.chatHistory as object[] }),
      ...(dto.recommendedPlan !== undefined && { recommendedPlan: dto.recommendedPlan }),
      source: dto.source ?? 'pricing_page',
    }

    const lead = await this.prisma.leadProfile.upsert({
      where: { sessionId: dto.sessionId ?? '' },
      create: base,
      update: base,
    })

    return { id: lead.id }
  }

  private extractPlan(text: string): string | undefined {
    if (text.includes('پلاس')) return 'gold'
    if (text.includes('اکو')) return 'silver'
    if (text.includes('رایگان')) return 'free'
    return undefined
  }
}
