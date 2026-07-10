import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { SalesBotConfig } from '@prisma/client'

const CACHE_TTL_MS = 60_000

// مقدار پیش‌فرض: چارچوب فروشی که در docs/PRD-sales-coach.md (بخش‌های ۲ و ۸) مستند شده —
// همان کانتکستی که قبلاً برای این ربات آماده شده بود، حالا از طریق ادمین قابل ویرایش است.
export const DEFAULT_CONTEXT_MD = `تو یک مشاور خرید هستی، نه یک فروشنده. نیوو یک دستیار هوش مصنوعی ایرانی با دسترسی راحت و پرداخت ریالی است.

هدفت این نیست که محصول را به‌زور بفروشی؛ هدفت این است که به کاربر کمک کنی تصمیم درستی بگیرد.
اگر محصول مناسب او نبود، صادقانه بگو. اگر مناسب بود، تا خرید هدایتش کن.

## شخصیت
دوستانه، شوخ‌طبع در حد مناسب، کوتاه‌گو، مودب، باهوش، با اعتماد‌به‌نفس.

## قانون طلایی
هرگز در اولین پیام محصول را معرفی نکن. اول بپرس برای چه کاری دنبال هوش مصنوعی است، چه شغلی دارد، چه چیزی امتحان کرده.

## کشف نیاز
باید طی مکالمه بفهمی: هدف کاربر، دردسر/مشکل فعلی‌اش، سیگنال بودجه (از لحن حدس بزن، مستقیم نپرس)، فوریت نیاز، سطح آشنایی‌اش با AI.

## منفعت، نه ویژگی
هیچ‌وقت مشخصات فنی خام نگو. همیشه به زبان نتیجه‌ی ملموس برای همین کاربر توضیح بده.

## قوانین سخت
۱. فقط درباره‌ی نیوو، پلن‌ها، و کاربردهای هوش مصنوعی صحبت کن.
۲. اگر سوال فنی/کمک درسی/کد خواستند، بگو کارها را بعد از شروع باهم انجام می‌دهید.
۳. رقبا را نام نبر یا مقایسه نکن.
۴. قیمت‌ها را دقیق بگو.
۵. هر پیام فقط یک هدف — حداکثر ۳ جمله.
۶. حداکثر ۱۵ پیام — بعد به ثبت‌نام هدایت کن.
۷. CTA فقط وقتی که نشونه‌ی آمادگی خرید دیدی.

## پلن‌ها
- رایگان: ۵ پیام/روز، بدون هزینه
- نقره‌ای: ۵۰ پیام/روز، ۱۵۰,۰۰۰ تومان/ماه
- طلایی: نامحدود، ۳۵۰,۰۰۰ تومان/ماه`

export const DEFAULT_DISCOUNT_PROMPT =
  'به نظر می‌رسه هنوز مطمئن نیستی — یه کد تخفیف ویژه برات کنار بذارم؟ فقط شماره‌ت رو بده 🎁'

export type UpdatableSalesBotConfig = Partial<
  Pick<SalesBotConfig, 'contextMd' | 'model' | 'maxMessages' | 'discountEnabled' | 'discountMinMessages' | 'discountPromptText'>
>

/**
 * تک نقطه‌ی دسترسی به SalesBotConfig (singleton) — هم برای مسیر چت عمومی (بدون لاگین،
 * روی هر پیام صدا زده می‌شود) و هم برای پنل ادمین. کش کوتاه‌مدت درون‌حافظه‌ای (نه Redis،
 * چون هر instance backend به‌روزرسانی را حداکثر با ۶۰ ثانیه تأخیر می‌بیند که برای این
 * مورد قابل قبول است) تا هر پیام یک round-trip اضافه به DB نداشته باشد.
 */
@Injectable()
export class SalesConfigService {
  private cached: SalesBotConfig | null = null
  private cachedAt = 0

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<SalesBotConfig> {
    const now = Date.now()
    if (this.cached && now - this.cachedAt < CACHE_TTL_MS) return this.cached

    const config = await this.prisma.salesBotConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', contextMd: DEFAULT_CONTEXT_MD, discountPromptText: DEFAULT_DISCOUNT_PROMPT },
      update: {},
    })

    this.cached = config
    this.cachedAt = now
    return config
  }

  async updateConfig(data: UpdatableSalesBotConfig): Promise<SalesBotConfig> {
    // dto class fields با مقدار undefined هم به‌صورت key صریح روی instance ست می‌شوند
    // (به خاطر useDefineForClassFields در تایپ‌اسکریپت)، پس باید قبل از spread حذف شوند
    // وگرنه مقادیر پیش‌فرض create را با undefined بازنویسی می‌کنند.
    const definedData = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))

    const config = await this.prisma.salesBotConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', contextMd: DEFAULT_CONTEXT_MD, discountPromptText: DEFAULT_DISCOUNT_PROMPT, ...definedData },
      update: definedData,
    })

    this.cached = config
    this.cachedAt = Date.now()
    return config
  }
}
