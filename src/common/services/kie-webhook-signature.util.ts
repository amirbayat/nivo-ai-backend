import { createHmac, timingSafeEqual } from 'node:crypto';

// طبق docs.kie.ai/common-api/webhook-verification (تایید‌شده ۱۴۰۵/۰۶/۲۷): امضا =
// base64(HMAC-SHA256(`${taskId}.${timestamp}`, webhookHmacKey))، هدرهای X-Webhook-Timestamp
// (ثانیه‌ی یونیکس، رشته‌ی خام) و X-Webhook-Signature. مقایسه با timingSafeEqual تا زمان‌سنجی
// اطلاعاتی درباره‌ی امضای درست لو ندهد.
const MAX_TIMESTAMP_SKEW_SEC = 5 * 60; // جلوگیری از replay — کالبک قدیمی‌تر از ۵ دقیقه رد می‌شود

export function verifyKieWebhookSignature(
  taskId: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!timestampHeader || !signatureHeader || !taskId) return false;

  const timestampSec = Number(timestampHeader);
  if (!Number.isFinite(timestampSec)) return false;
  const nowSec = Date.now() / 1000;
  if (Math.abs(nowSec - timestampSec) > MAX_TIMESTAMP_SKEW_SEC) return false;

  const expected = createHmac('sha256', secret)
    .update(`${taskId}.${timestampHeader}`)
    .digest('base64');

  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}
