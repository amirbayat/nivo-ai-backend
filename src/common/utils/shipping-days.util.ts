// R3.3 — بازه‌ی روز کاری ارسال فروشگاه (Store.shippingDaysMin/Max)؛ هر دو یا هیچ‌کدام
export const SHIPPING_DAYS_MAX = 60;

export function isValidShippingDays(
  min: number | null | undefined,
  max: number | null | undefined,
): boolean {
  const hasMin = min !== null && min !== undefined;
  const hasMax = max !== null && max !== undefined;
  if (!hasMin && !hasMax) return true;
  if (!hasMin || !hasMax) return false;
  return (
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    min >= 1 &&
    max <= SHIPPING_DAYS_MAX &&
    min <= max
  );
}

// جمله‌ی ثابت برای پیام تایید سفارش و دانش AI؛ بدون بازه‌ی کامل چیزی ساخته نمی‌شود
export function formatShippingDays(
  min: number | null | undefined,
  max: number | null | undefined,
): string | null {
  if (!isValidShippingDays(min, max) || min == null || max == null) return null;
  const fmt = (n: number) => n.toLocaleString('fa-IR');
  const range = min === max ? fmt(min) : `${fmt(min)}–${fmt(max)}`;
  return `معمولاً ${range} روز کاری ارسال می‌شه`;
}
