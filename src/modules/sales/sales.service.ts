import { Injectable, HttpException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import type { SalesBotConfig } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { PricingService } from '../usage/pricing.service'
import { SalesConfigService } from './sales-config.service'
import { SalesKbService } from './sales-kb.service'
import type { SalesChatDto, SaveLeadDto } from './dto/sales-chat.dto'

const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000
function iranDate(): string {
  return new Date(Date.now() + IRAN_OFFSET_MS).toISOString().slice(0, 10)
}

interface DailyUsageDelta {
  messageCount?: number
  tokensInput?: number
  tokensOutput?: number
  costToman?: number
  costUsdMicros?: number
  sessionsStarted?: number
  discountOffersShown?: number
  phonesCaptured?: number
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name)
  private readonly provider

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly salesConfig: SalesConfigService,
    private readonly salesKb: SalesKbService,
    private readonly pricingService: PricingService,
  ) {
    this.provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey: this.config.get<string>('LIARA_API_KEY')!,
    })
  }

  async chat(
    dto: SalesChatDto,
    ip: string,
  ): Promise<{ reply: string; isDone: boolean; recommendedPlan?: string; offerDiscount?: boolean }> {
    // rate limit: 30 requests per hour per IP
    const rlKey = `sales:rl:${ip}:${iranDate()}`
    const count = await this.redis.incr(rlKey)
    if (count === 1) await this.redis.expire(rlKey, 3600)
    if (count > 30) throw new HttpException('تعداد درخواست بیش از حد مجاز است', 429)

    const botConfig = await this.salesConfig.getConfig()
    const messages = dto.messages.slice(-botConfig.maxMessages)
    const isDone = messages.length >= botConfig.maxMessages
    const isFirstMessage = dto.messages.length <= 1

    // بازیابی معنایی (RAG) — docs/PRD-sales-kb-rag-and-plan-context.md بخش الف.۷.
    // اگر هیچ نمونه‌ای از آستانه‌ی شباهت بالاتر نرفت، هیچ بلوکی اضافه نمی‌شود.
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content
    const kbExamples = lastUserMessage
      ? await this.salesKb.retrieveRelevant(lastUserMessage).catch(() => [])
      : []
    const kbBlock = kbExamples.length
      ? '\n\n## نمونه‌های مرتبط با این مکالمه\n\n' +
        kbExamples
          .map(e => `کاربر: ${e.userMessage}\nپاسخ: ${e.assistantReply}`)
          .join('\n\n---\n\n')
      : ''

    const finalSystemPrompt = botConfig.contextMd + kbBlock
    const outgoingMessages = messages.map(m => ({ role: m.role, content: m.content }))

    // لاگ کامل درخواست به لیارا — عمداً log (نه debug)، پیش‌فرض NestJS نشانش می‌دهد.
    // برای رفع اشکال «آیا کانتکست درست فرستاده می‌شود؟» — بعداً می‌تواند حذف/به‌سطح debug برگردد.
    this.logger.log(
      `[sales.chat] sessionId=${dto.sessionId} model=${botConfig.model} kbExamples=${kbExamples.length}\n` +
        `--- system prompt (${finalSystemPrompt.length} chars) ---\n${finalSystemPrompt}\n` +
        `--- messages (${outgoingMessages.length}) ---\n${JSON.stringify(outgoingMessages, null, 2)}`,
    )

    let text: string
    let inputTokens = 0
    let outputTokens = 0
    try {
      const result = await generateText({
        model: this.provider(botConfig.model),
        system: finalSystemPrompt,
        messages: outgoingMessages,
        maxOutputTokens: 400,
      })
      text = result.text
      const usage = await result.usage
      inputTokens = usage.inputTokens ?? 0
      outputTokens = usage.outputTokens ?? 0
    } catch {
      return {
        reply: 'سرویس هوش مصنوعی در حال حاضر در دسترس نیست. چند دقیقه دیگر دوباره امتحان کن 🙏',
        isDone: false,
      }
    }

    const recommendedPlan = this.extractPlan(text)
    const cost = await this.pricingService.calcCost(inputTokens, outputTokens, botConfig.model)

    // آنالیتیکس نباید در صورت شکست، پاسخ به کاربر را fail کند
    await this.recordDailyUsage({
      messageCount: 1,
      tokensInput: inputTokens,
      tokensOutput: outputTokens,
      costToman: cost.costToman,
      costUsdMicros: cost.costUsdMicros,
      sessionsStarted: isFirstMessage ? 1 : 0,
    }).catch(() => {})

    const offerDiscount = await this.maybeOfferDiscount(
      dto.sessionId,
      botConfig,
      dto.messages.length,
      recommendedPlan,
    )

    // تاریخچه‌ی مکالمه برای ادمین (بخش «تاریخچه» در /admin/sales-bot) — عمداً overwrite
    // می‌شود، نه append، چون فرانت هر بار کل تاریخچه‌ی تاکنون را در dto.messages می‌فرستد.
    this.saveChatSession(dto.sessionId, dto.messages, text).catch(() => {})

    return {
      reply: text,
      isDone,
      ...(recommendedPlan ? { recommendedPlan } : {}),
      ...(offerDiscount ? { offerDiscount: true } : {}),
    }
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
      ...(dto.discountRequested !== undefined && { discountOffered: dto.discountRequested }),
      source: dto.source ?? 'pricing_page',
    }

    const lead = await this.prisma.leadProfile.upsert({
      where: { sessionId: dto.sessionId ?? '' },
      create: base,
      update: base,
    })

    if (dto.phone) {
      await this.recordDailyUsage({ phonesCaptured: 1 }).catch(() => {})
    }

    return { id: lead.id }
  }

  // تشخیص قطعی و بدون‌هزینه‌ی AI اضافه (docs/PRD-sales-bot-dashboard.md بخش ۸.۱):
  // مکالمه طولانی شده ولی هنوز به سمت یک پلن مشخص نرفته → سیگنال دودلی/نبود قصد خرید فوری.
  private async maybeOfferDiscount(
    sessionId: string,
    botConfig: SalesBotConfig,
    messageCount: number,
    recommendedPlan: string | undefined,
  ): Promise<boolean> {
    if (!botConfig.discountEnabled) return false
    if (messageCount < botConfig.discountMinMessages) return false
    if (recommendedPlan) return false // در حال همگرایی به یک تصمیم — نیازی به بهانه‌ی تخفیف نیست

    const lead = await this.prisma.leadProfile.findUnique({ where: { sessionId } })
    if (lead?.phone || lead?.discountOffered) return false

    await this.prisma.leadProfile.upsert({
      where: { sessionId },
      create: { sessionId, discountOffered: true, source: 'discount_offer' },
      update: { discountOffered: true },
    })
    await this.recordDailyUsage({ discountOffersShown: 1 }).catch(() => {})

    return true
  }

  private async recordDailyUsage(delta: DailyUsageDelta): Promise<void> {
    const date = new Date(iranDate())
    const data = {
      messageCount: delta.messageCount ?? 0,
      tokensInput: delta.tokensInput ?? 0,
      tokensOutput: delta.tokensOutput ?? 0,
      costToman: delta.costToman ?? 0,
      costUsdMicros: delta.costUsdMicros ?? 0,
      sessionsStarted: delta.sessionsStarted ?? 0,
      discountOffersShown: delta.discountOffersShown ?? 0,
      phonesCaptured: delta.phonesCaptured ?? 0,
    }

    await this.prisma.salesBotDailyUsage.upsert({
      where: { date },
      create: { date, ...data },
      update: {
        messageCount: { increment: data.messageCount },
        tokensInput: { increment: data.tokensInput },
        tokensOutput: { increment: data.tokensOutput },
        costToman: { increment: data.costToman },
        costUsdMicros: { increment: data.costUsdMicros },
        sessionsStarted: { increment: data.sessionsStarted },
        discountOffersShown: { increment: data.discountOffersShown },
        phonesCaptured: { increment: data.phonesCaptured },
      },
    })
  }

  private async saveChatSession(
    sessionId: string,
    priorMessages: { role: 'user' | 'assistant'; content: string }[],
    assistantReply: string,
  ): Promise<void> {
    const messages = [...priorMessages, { role: 'assistant' as const, content: assistantReply }]
    await this.prisma.salesChatSession.upsert({
      where: { sessionId },
      create: { sessionId, messages, messageCount: messages.length },
      update: { messages, messageCount: messages.length, lastMessageAt: new Date() },
    })
  }

  private extractPlan(text: string): string | undefined {
    if (text.includes('پلاس')) return 'gold'
    if (text.includes('اکو')) return 'silver'
    if (text.includes('رایگان')) return 'free'
    return undefined
  }
}
