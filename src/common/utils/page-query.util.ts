import { toEnglishDigits } from './normalize-digits';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

// R3.2 — پارامترهای cursor pagination از query string (رشته‌های خام). limit نامعتبر ← پیش‌فرض،
// بزرگ ← سقف؛ cursor خالی ← undefined (صفحه‌ی اول)
export function parsePageQuery(
  cursor?: string,
  limit?: string | number,
): { cursor?: string; limit: number } {
  const n = Math.floor(Number(toEnglishDigits(String(limit ?? ''))));
  const size =
    Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const c = cursor?.trim();
  return { cursor: c ? c.slice(0, 64) : undefined, limit: size };
}
