// A/B تست مدل‌های AI موتور مکالمه (فیدبک اول پایلوت، ۱۴۰۵/۰۷/۰۷) — همه‌ی این slugها روی
// OpenRouter تأیید شده‌اند (چک دستی)، حدسی نیستند. کلید (نه خودِ slug) روی
// SalesConversation.abVariant ذخیره می‌شود تا اگر بعداً slug یک مدل عوض شد، دیتای آماری
// قدیمی بی‌معنی نشود.
// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۴ — ۱۴۰۵/۰۷/۱۹: gpt-5.4-mini به درخواست
// کاربر از pool فروشنده حذف شد. claude-sonnet-5.5 جایگزین شد چون این کلید هم مدل fallback
// پیش‌فرض است هم «شبکه‌ی ایمنی» کل موتور (resolveModel()/defaultModel() پایین) — نیاز به
// باثبات‌ترین گزینه برای tool-calling داشت، نه لزوماً ارزان‌ترین.
export const DEFAULT_VARIANT_KEY = 'claude-sonnet-5.5';

export const MODEL_VARIANTS: Record<string, string> = {
  'gpt-6-luna': 'openai/gpt-6-luna',
  'gpt-6.1-sol': 'openai/gpt-6.1-sol',
  'gemini-3.8-flash': 'google/gemini-3.8-flash',
  'claude-sonnet-5.5': 'anthropic/claude-sonnet-5.5',
  'grok-4.7': 'x-ai/grok-4.7',
  // typesafe/jev-router ۱۴۰۵/۰۷/۰۱ و gpt-5.4-mini ۱۴۰۵/۰۷/۱۹ از pool حذف شدند (اولی: کیفیت
  // پاسخ ضعیف؛ دومی: فیدبک مستقیم کاربر). resolveModel() پایین یک fallback امن دارد، پس
  // مکالمه‌های قدیمی که از قبل abVariant با یکی از این دو کلید دارند هم بدون کرش به مدل
  // پیش‌فرض جدید می‌افتند.
};

const VARIANT_KEYS = Object.keys(MODEL_VARIANTS);

export function pickVariant(): string {
  return VARIANT_KEYS[Math.floor(Math.random() * VARIANT_KEYS.length)];
}

// docs/PRD-sales-agent-voice.md بخش ۶.۱ — قبلاً یک A/B تصادفی ۵۰/۵۰ بود (نیمی از مکالمه‌ها
// هیچ‌وقت وویس نمی‌گرفتند). کاربر ۱۴۰۵/۰۷/۱۲ صریحاً خواست وویس کلاً روشن باشد (فیدبک: روی
// تلگرام اصلاً وویس نمی‌داد) — عیناً همان کات‌اوور pickResponseStrategy پایین؛ کد قدیمی حذف
// نشده، فقط دیگر OFF برنمی‌گرداند. محدودیت‌های دیگر (VOICE_MIN_REPLY_CHARS، سقف
// freeVoiceConversationsUsed و...) در conversation-engine.service.ts دست‌نخورده می‌مانند.
export function pickVoiceVariant(): 'ON' | 'OFF' {
  return 'ON';
}

// docs/PRD-sales-agent-tool-calling-architecture.md بخش ۷ (فاز ۴) — ۱۴۰۵/۰۷/۱۲: بعد از
// تست زنده‌ی FULL_AGENT با API واقعی (باگ فالو-آپ فیکس تایید شد، نادج درست کار می‌کند، هیچ
// عدد/موجودی ساختگی/فاش‌شده دیده نشد)، کاربر صریحاً تصمیم به کات‌اوور کامل (۱۰۰٪) گرفت — بدون
// صبر برای داده‌ی ترافیک واقعی از فاز ۳ (سوییچ دستی)، آگاهانه. RULE_BASED/SIMPLE_AGENT دیگر
// برای مکالمه‌ی تصادفی جدید انتخاب نمی‌شوند (کدشان حذف نشده، فقط دیگر از اینجا صدا زده نمی‌شوند؛
// برگشت احتمالی فقط همین یک خط است). گپ شناخته‌شده‌ی پذیرفته‌شده: چون parseIntent دیگر برای این
// مکالمه‌ها اجرا نمی‌شود، آنالیتیکس buyerNeeds (docs/PRD-buyer-preference-personalization.md)
// از این به بعد برای مکالمات جدید جمع نمی‌شود.
export function pickResponseStrategy():
  'RULE_BASED' | 'SIMPLE_AGENT' | 'FULL_AGENT' {
  return 'FULL_AGENT';
}

export function resolveModel(variant: string | null | undefined): string {
  return (
    (variant ? MODEL_VARIANTS[variant] : undefined) ??
    MODEL_VARIANTS[DEFAULT_VARIANT_KEY]
  );
}

export function defaultModel(): string {
  return MODEL_VARIANTS[DEFAULT_VARIANT_KEY];
}
