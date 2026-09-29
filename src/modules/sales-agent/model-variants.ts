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
};

const VARIANT_KEYS = Object.keys(MODEL_VARIANTS);

export function pickVariant(): string {
  return VARIANT_KEYS[Math.floor(Math.random() * VARIANT_KEYS.length)];
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
