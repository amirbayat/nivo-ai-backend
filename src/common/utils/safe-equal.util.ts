import { createHash, timingSafeEqual } from 'crypto';

// 2.6 — مقایسه‌ی secret/token بدون نشت زمان. هر دو طرف اول SHA-256 می‌شوند تا طول یکسان شود
// (timingSafeEqual روی طول نابرابر throw می‌کند و خودِ طول را لو می‌دهد).
export function safeEqual(
  provided: string | undefined | null,
  expected: string | undefined | null,
): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
