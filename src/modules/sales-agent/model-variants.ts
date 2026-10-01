// A/B تست مدل‌های AI موتور مکالمه (فیدبک اول پایلوت، ۱۴۰۵/۰۷/۰۷) — همه‌ی این slugها روی
// OpenRouter تأیید شده‌اند (چک دستی)، حدسی نیستند. کلید (نه خودِ slug) روی
// SalesConversation.abVariant ذخیره می‌شود تا اگر بعداً slug یک مدل عوض شد، دیتای آماری
// قدیمی بی‌معنی نشود.
export const DEFAULT_VARIANT_KEY = 'gpt-5.4-mini';

export const MODEL_VARIANTS: Record<string, string> = {
  'gpt-5.4-mini': 'openai/gpt-5.4-mini',
  'gpt-6-luna': 'openai/gpt-6-luna',
  'gpt-6.1-sol': 'openai/gpt-6.1-sol',
  'gemini-3.8-flash': 'google/gemini-3.8-flash',
  'claude-sonnet-5.5': 'anthropic/claude-sonnet-5.5',
  'grok-4.7': 'x-ai/grok-4.7',
  // typesafe/jev-router ۱۴۰۵/۰۷/۰۱ از pool حذف شد — فیدبک کاربر: کیفیت پاسخ ضعیف بود.
  // resolveModel() پایین یک fallback امن دارد، پس مکالمه‌های قدیمی که از قبل
  // abVariant:'jev-router' دارند هم بدون کرش به مدل پیش‌فرض می‌افتند.
};

const VARIANT_KEYS = Object.keys(MODEL_VARIANTS);

export function pickVariant(): string {
  return VARIANT_KEYS[Math.floor(Math.random() * VARIANT_KEYS.length)];
}

// docs/PRD-sales-agent-voice.md بخش ۶.۱ — A/B تست جدا از انتخاب مدل بالا (عمود متفاوت:
// «وویس بفرستیم یا نه»)، یک‌بار در ساخت مکالمه تصادفی (۵۰/۵۰) تعیین می‌شود.
export function pickVoiceVariant(): 'ON' | 'OFF' {
  return Math.random() < 0.5 ? 'ON' : 'OFF';
}

// docs/PRD-sales-agent-response-strategy-ab.md بخش ۸ — eval واقعی (۴ اجرای مستقل) نشان داد
// Track B (agent) به‌طور پیوسته از Track A دقیق‌تر است (~۷۷-۸۴٪ در برابر ~۶۰-۶۱٪)، ولی
// هزینه/تاخیر واقعی‌اش هنوز اندازه‌گیری نشده (قطعاً چند فراخوان بیشتر از Track A دارد) — تا آن
// اندازه‌گیری انجام نشود، پیش‌فرض محتاطانه RULE_BASED می‌ماند. کد Track B کامل و پشت
// SIMPLE_AGENT آماده است (doBrowse)، فقط فعلاً هیچ مکالمه‌ی واقعی‌ای تصادفی به آن نمی‌رسد.
export function pickResponseStrategy(): 'RULE_BASED' | 'SIMPLE_AGENT' {
  return 'RULE_BASED';
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
