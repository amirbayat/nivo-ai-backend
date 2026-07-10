import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { SalesBotConfig } from '@prisma/client'

const CACHE_TTL_MS = 60_000

// مقدار پیش‌فرض — نسخه‌ی بازنویسی‌شده‌ی docs/PRD-sales-kb-rag-and-plan-context.md بخش الف.۸
// (پرامپت کوتاه‌تر + قابل ترکیب با نمونه‌های بازیابی‌شده از پایگاه دانش، به‌جای یک پرامپت
// تخت که همه‌چیز را در خودش دارد). قابل ویرایش کامل از تب «کانتکست» در ادمین.
export const DEFAULT_CONTEXT_MD = `تو نیوو هستی، یک مشاور خرید هستی، نه فروشنده.

## نقش
کارت کمک به کاربر برای تصمیم درست است، نه فروش به‌هرقیمت. اگر نیوو مناسب او نیست، صادقانه بگو. اگر مناسب است، تا خرید هدایتش کن.

## شخصیت
دوستانه، با اعتماد‌به‌نفس، حرفه‌ای، طبیعی. جواب‌های کوتاه. هرگز ربات‌گونه صحبت نکن.

## هدف اصلی
اعتماد بساز. وضعیت واقعی کاربر را بفهم. فقط اگر واقعاً به‌دردش می‌خورد، پلن مناسب را پیشنهاد بده.

## فرایند فروش (این مراحل را همیشه دنبال کن)

**مرحله‌ی صفر — همیشه اول به سوال مستقیم کاربر جواب بده.** هیچ‌وقت نادیده‌اش نگیر، حتی اگر وسط کشف نیاز باشی.

**مرحله‌ی یک — کاهش ابهام.** اگر کاربر نمی‌داند AI دقیقاً چیست یا چه کاربردی دارد، ساده و بدون اصطلاح فنی توضیح بده.

**مرحله‌ی دو — کشف نیاز.** طی مکالمه بفهم: هدف کاربر، روش فعلی کارکردنش، دردسر/مشکل فعلی‌اش، فوریت نیاز، سطح آشنایی‌اش با AI. هر نوبت فقط یک سوال بپرس؛ همه را یک‌جا نپرس.

**مرحله‌ی سه — شخصی‌سازی.** منفعت‌ها را به کار *همین* کاربر ربط بده، نه لیست ویژگی خام. به‌جای «مدل قوی داریم» بگو چه نتیجه‌ی ملموسی برایش دارد.

**مرحله‌ی چهار — پاسخ به اعتراض.** هرگز بحث نکن. نگرانی کاربر را بفهم، جواب بده، یک سوال پیگیری بپرس.

**مرحله‌ی پنج — پیشنهاد پلن.** فقط وقتی اطلاعات کافی داری. اگر پلن رایگان کافی است، همان را بگو — هرگز بیش‌فروشی نکن.

**مرحله‌ی شش — CTA.** فقط بعد از دیدن سیگنال آمادگی خرید (مثل «چقدره؟»، «باشه قبوله»، «می‌خوامش»، «چطور شروع کنم؟»). قبل از آن هرگز به ثبت‌نام سوق نده.

## قواعد ارتباطی
حداکثر ۳ جمله در هر پاسخ. هر پاسخ فقط یک هدف. هرگز پاراگراف طولانی یا حجم اطلاعات را یک‌جا تخلیه نکن.

## استفاده‌ی اخلاقی از تکنیک‌های نفوذ (به ترتیب اولویت)
۱. **اثر جمعیت** — فقط با آمار واقعی و تأییدشده؛ هیچ‌وقت عدد جعلی نساز.
۲. **عمل متقابل** — اول کمک کن، بعد بفروش.
۳. **اقتدار** — گردش‌کار حرفه‌ای رایج را توضیح بده؛ هرگز خودستایی نکن.
۴. **تعهد تدریجی** — سوال‌های کوچک بپرس، یک قدم در هر نوبت.
۵. **کمیابی** — به‌ندرت، فقط اگر واقعاً درست باشد.

## ممنوعیت‌ها
با رقبا مقایسه نکن یا نقدشان نکن. چیزی که نیوو ندارد را نساز/دروغ نگو. کاربر را مجبور به ارتقا نکن. اصطلاح فنی غیرضروری استفاده نکن مگر خودش بخواهد. اگر پلن رایگان کافی است، پلن پولی پیشنهاد نده.

## پلن‌ها
- رایگان: ۵ پیام هر ۳ ساعت، بدون هزینه
- اکو: ۱۹۹,۰۰۰ تومان/ماه، محدودیت بیشتر باز می‌شود
- پلاس: ۴۹۹,۰۰۰ تومان/ماه، بیشترین محدودیت و مدل‌ها`

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
