import { APICallError, NoOutputGeneratedError, RetryError } from 'ai';

// streamText خطای واقعی provider (APICallError) رو لایه‌به‌لایه می‌پیچه: وقتی stream بدون
// هیچ متنی تموم بشه NoOutputGeneratedError پرتاب می‌کنه که cause‌ش معمولاً RetryError است، و
// RetryError خودش خطای واقعی رو توی lastError نگه می‌داره (تایید شده از stack trace واقعی
// این خطا در پروداکشن). بدون این unwrap، APICallError.isInstance(err) همیشه false برمی‌گرده
// و کاربر پیام کلی «خطا در ارسال پیام» می‌بیند به‌جای «مدل در دسترس نیست».
export function unwrapAiSdkError(err: unknown): unknown {
  let current = err;
  if (NoOutputGeneratedError.isInstance(current) && current.cause) {
    current = current.cause;
  }
  if (RetryError.isInstance(current)) {
    current = current.lastError;
  }
  return current;
}

export function isModelUnavailableError(err: unknown): boolean {
  return APICallError.isInstance(unwrapAiSdkError(err));
}
