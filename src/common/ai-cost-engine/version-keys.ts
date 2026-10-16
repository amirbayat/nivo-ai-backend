import { aceRuntime } from './ace-runtime';

// ACE-3 — کلید نسخه‌ی منابع هر کش. هر نوشتن روی فروشگاه/محصول/KB نسخه را بالا می‌برد → کلیدهای قدیمی miss.
// نسخه‌ی prompt: ثابت دستی؛ هر تغییر prompt باید آن را بالا ببرد.
export const ACE_PROMPT_VERSION = '2026-10-16.1';

const key = (kind: 'store' | 'kb' | 'product', id: string) => `ace:ver:${kind}:${id}`;

export async function getVersion(kind: 'store' | 'kb' | 'product', id: string): Promise<string> {
  try {
    return (await aceRuntime().redis?.get(key(kind, id))) ?? '0';
  } catch {
    return '0';
  }
}

// نسخه‌ی ترکیبی منابع یک call؛ خطا → 'x' (کش را بی‌اثر می‌کند چون هر بار فرق دارد؟ نه: ثابت 'x' مشترک
// خطرناک است، پس در خطا null برمی‌گردد و memo کنار می‌کشد)
export async function versionsFor(src: { storeId?: string; kb?: boolean; productIds?: string[] }): Promise<string | null> {
  const redis = aceRuntime().redis;
  if (!redis) return null;
  try {
    const parts: string[] = [ACE_PROMPT_VERSION];
    if (src.storeId) parts.push(`s${(await redis.get(key('store', src.storeId))) ?? '0'}`);
    if (src.storeId && src.kb) parts.push(`k${(await redis.get(key('kb', src.storeId))) ?? '0'}`);
    for (const pid of src.productIds ?? []) parts.push(`p${(await redis.get(key('product', pid))) ?? '0'}`);
    return parts.join('.');
  } catch {
    return null;
  }
}

// بعد از commit تراکنش صدا بزن؛ خطای Redis فقط نادیده گرفته می‌شود
export async function bumpVersions(input: { storeId?: string; kb?: boolean; productIds?: string[] }): Promise<void> {
  const redis = aceRuntime().redis;
  if (!redis) return;
  try {
    if (input.storeId) await redis.incr(key('store', input.storeId));
    if (input.storeId && input.kb) await redis.incr(key('kb', input.storeId));
    for (const pid of input.productIds ?? []) await redis.incr(key('product', pid));
  } catch {
    /* fail-open */
  }
}
