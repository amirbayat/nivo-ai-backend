import { randomInt } from 'crypto';
import { toEnglishDigits } from './normalize-digits';

// docs/PRD-nivo-sales-unified.md 3.4 / مشخصات الف ۶.۲ — «NV» + ۶ نویسه از الفبای ۳۱تایی بدون
// نویسه‌های مبهم (حذف 0 O 1 I L). تصادفی (نه ترتیبی) تا شمردن حجم سفارش‌ها ممکن نباشد.
// کد یک «شناسه» است نه رمز: دیدن سفارش با کد همیشه نیازمند احراز مالکیت است.
export const ORDER_CODE_PREFIX = 'NV';
export const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ORDER_CODE_BODY_LENGTH = 6;
export const ORDER_CODE_MAX_ATTEMPTS = 5;

export function generateOrderCode(): string {
  let body = '';
  for (let i = 0; i < ORDER_CODE_BODY_LENGTH; i++) {
    body += ORDER_CODE_ALPHABET[randomInt(ORDER_CODE_ALPHABET.length)];
  }
  return ORDER_CODE_PREFIX + body;
}

// نمایش با خط تیره: NVK7M2QX → NV-K7M2QX (کد قدیمی/خالی → null)
export function formatOrderCode(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return code.startsWith(ORDER_CODE_PREFIX)
    ? `${ORDER_CODE_PREFIX}-${code.slice(ORDER_CODE_PREFIX.length)}`
    : code;
}

// برای سفارش قدیمی بدون کد (backfill عقب بود): ۸ نویسه‌ی اول id
export function displayOrderCode(order: {
  id: string;
  orderCode?: string | null;
}): string {
  return formatOrderCode(order.orderCode) ?? order.id.slice(0, 8);
}

// ورودی جست‌وجو: حروف بزرگ، حذف خط‌تیره/فاصله، ارقام فارسی/عربی→انگلیسی. اگر نتیجه یک کد
// کامل معتبر باشد برمی‌گرداند، وگرنه null (جست‌وجوی کد فقط تطبیق دقیق است). پیشوند NV اختیاری است.
export function normalizeOrderCodeInput(raw: string): string | null {
  const cleaned = toEnglishDigits(raw ?? '')
    .toUpperCase()
    .replace(/[\s\-_.]/g, '');
  const body = cleaned.startsWith(ORDER_CODE_PREFIX)
    ? cleaned.slice(ORDER_CODE_PREFIX.length)
    : cleaned;
  if (body.length !== ORDER_CODE_BODY_LENGTH) return null;
  for (const ch of body) if (!ORDER_CODE_ALPHABET.includes(ch)) return null;
  return ORDER_CODE_PREFIX + body;
}

// جست‌وجوی جزئی در پنل فروشنده: فروشنده لازم نیست کل کد را بزند. حروف بزرگ، حذف جداکننده‌ها،
// پیشوند NV اختیاری؛ اگر حداقل ۲ نویسه از الفبای کد باقی بماند همان را برمی‌گرداند، وگرنه null
// (مثلاً «علی» یا شماره‌تلفن نباید به جست‌وجوی کد تبدیل شود).
export function normalizeOrderCodePartialInput(raw: string): string | null {
  const cleaned = toEnglishDigits(raw ?? '')
    .toUpperCase()
    .replace(/[\s\-_.]/g, '');
  const body =
    cleaned.startsWith(ORDER_CODE_PREFIX) && cleaned.length > ORDER_CODE_PREFIX.length
      ? cleaned.slice(ORDER_CODE_PREFIX.length)
      : cleaned;
  if (body.length < 2 || body.length > ORDER_CODE_BODY_LENGTH) return null;
  for (const ch of body) if (!ORDER_CODE_ALPHABET.includes(ch)) return null;
  return body;
}
