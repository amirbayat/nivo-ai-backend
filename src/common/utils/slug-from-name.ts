import { randomBytes } from 'crypto';

// docs/PRD-seller-panel-simplification.md §4.2 — پورت سمت سرور از
// nivo-ai-frontend/src/lib/slugFromName.ts؛ جدول حروف و قواعد باید با آن فایل یکی بماند.
const LETTERS: Record<string, string> = {
  ا: 'a', آ: 'a', أ: 'a', إ: 'a', ب: 'b', پ: 'p', ت: 't', ث: 's', ج: 'j', چ: 'ch',
  ح: 'h', خ: 'kh', د: 'd', ذ: 'z', ر: 'r', ز: 'z', ژ: 'zh', س: 's', ش: 'sh', ص: 's',
  ض: 'z', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ک: 'k', ك: 'k', گ: 'g',
  ل: 'l', م: 'm', ن: 'n', و: 'o', ه: 'h', ة: 'h', ی: 'i', ي: 'i', ئ: 'i', ء: '',
};

export const SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;

export function slugFromName(name: string): string {
  let out = '';
  for (const char of name.trim().toLowerCase()) {
    if (/[a-z0-9]/.test(char)) {
      out += char;
      continue;
    }
    if (char === ' ' || char === '-' || char === '_' || char === '‌') {
      out += '-';
      continue;
    }
    const mapped = LETTERS[char];
    if (mapped) out += mapped;
  }
  const slug = out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return slug.length >= 3 ? slug : '';
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function randomSlugChars(n: number): string {
  const bytes = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

export interface SlugSuggestion {
  slug: string;
  requestedAvailable: boolean;
}

// base معتبر ← اولین آزاد از base، base-2 … base-9، بعد base-<۴ حرف تصادفی>؛ base کوتاه‌تر از ۳
// حرف ← shop-<۶ حرف تصادفی>. isTaken فقط وجود رکورد را می‌پرسد (race را P2002 در create می‌گیرد).
export async function suggestSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<SlugSuggestion> {
  if (base.length < 3) {
    return { slug: `shop-${randomSlugChars(6)}`, requestedAvailable: false };
  }
  if (!(await isTaken(base))) return { slug: base, requestedAvailable: true };
  for (let i = 2; i <= 9; i++) {
    const candidate = `${base}-${i}`.slice(0, 40);
    if (!(await isTaken(candidate))) return { slug: candidate, requestedAvailable: false };
  }
  return {
    slug: `${base.slice(0, 35)}-${randomSlugChars(4)}`,
    requestedAvailable: false,
  };
}
