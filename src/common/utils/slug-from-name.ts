import { randomBytes } from 'crypto';

// docs/PRD-seller-panel-simplification.md §4.2 — پورت سمت سرور از
// nivo-ai-frontend/src/lib/slugFromName.ts؛ جدول حروف و قواعد باید با آن فایل یکی بماند.
const LETTERS: Record<string, string> = {
  ا: 'a',
  آ: 'a',
  أ: 'a',
  إ: 'a',
  ب: 'b',
  پ: 'p',
  ت: 't',
  ث: 's',
  ج: 'j',
  چ: 'ch',
  ح: 'h',
  خ: 'kh',
  د: 'd',
  ذ: 'z',
  ر: 'r',
  ز: 'z',
  ژ: 'zh',
  س: 's',
  ش: 'sh',
  ص: 's',
  ض: 'z',
  ط: 't',
  ظ: 'z',
  ع: 'a',
  غ: 'gh',
  ف: 'f',
  ق: 'q',
  ک: 'k',
  ك: 'k',
  گ: 'g',
  ل: 'l',
  م: 'm',
  ن: 'n',
  ه: 'h',
  ة: 'h',
  ئ: 'i',
  ؤ: 'o',
  ء: '',
};

const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const VOWEL_LETTERS = new Set(['ا', 'آ', 'أ', 'إ', 'ی', 'ي', 'ئ']);

// کلمه‌های پرتکرار نام فروشگاه که قاعده‌ی عمومی (بدون اعراب) خوانا درنمی‌آورد.
const WORDS: Record<string, string> = {
  فروشگاه: 'forooshgah',
  فروش: 'foroosh',
  فروشی: 'foroshi',
  نیوو: 'nivo',
  و: 'va',
  استودیو: 'studio',
  سوپرمارکت: 'supermarket',
  هنر: 'honar',
  کودک: 'koodak',
  میوه: 'mive',
  عطر: 'atr',
  لوازم: 'lavazem',
  حیوانات: 'heyvanat',
  نانوایی: 'nanvaee',
  نیو: 'nio',
  تست: 'test',
  لباس: 'lebas',
  بچه: 'bache',
  بچگانه: 'bachegane',
  پوشاک: 'pooshak',
  کیف: 'kif',
  کفش: 'kafsh',
  گالری: 'gallery',
  طلا: 'tala',
  زیبایی: 'zibaee',
  آرایشی: 'arayeshi',
  بهداشتی: 'behdashti',
  خانه: 'khane',
  مهتاب: 'mahtab',
  دیجیتال: 'digital',
  موبایل: 'mobile',
  اسباب: 'asbab',
  بازی: 'bazi',
  ایران: 'iran',
  نو: 'no',
  سنتی: 'sonati',
  هنری: 'honari',
  کتاب: 'ketab',
};

const isLetter = (c: string | undefined): boolean =>
  !!c && (c in LETTERS || c === 'و' || c === 'ی' || c === 'ي');

// حرف‌نگاری یک کلمه‌ی فارسی. هدف خوانایی است، نه دقت آوایی.
function transliterateWord(word: string): string {
  const known = WORDS[word];
  if (known) return known;
  const chars = Array.from(word);
  let out = '';
  chars.forEach((c, i) => {
    const prev = chars[i - 1];
    const next = chars[i + 1];
    const atStart = i === 0;
    const atEnd = i === chars.length - 1;
    let piece: string;
    if (c === 'و') {
      if (atStart || (prev && VOWEL_LETTERS.has(prev))) piece = 'v';
      else if (prev === 'و') piece = 'o';
      else piece = atEnd ? 'o' : 'oo';
    } else if (c === 'ی' || c === 'ي') {
      piece = atStart ? 'y' : 'i';
    } else if (c === 'ه') {
      // ه‌ی پایانیِ بعد از همخوان صدای «e» دارد (بچه ← bache)
      piece =
        atEnd &&
        prev &&
        !VOWEL_LETTERS.has(prev) &&
        prev !== 'و' &&
        isLetter(prev)
          ? 'e'
          : 'h';
    } else {
      piece = LETTERS[c] ?? '';
      // خوشه‌ی همخوانیِ ابتدای کلمه (لباس ← lebas، تست ← test): بعد از حرف اول «e»
      if (
        atStart &&
        piece &&
        !VOWEL_LETTERS.has(c) &&
        c !== 'ع' &&
        next &&
        isLetter(next) &&
        next !== 'و' &&
        !VOWEL_LETTERS.has(next) &&
        next !== 'ع'
      ) {
        piece += 'e';
      }
    }
    out += piece;
  });
  return out;
}

export const SLUG_PATTERN = /^[a-z0-9-]{3,40}$/;

export function slugFromName(name: string): string {
  let out = '';
  let word = '';
  const flush = () => {
    if (word) out += transliterateWord(word);
    word = '';
  };
  for (const raw of name.trim().toLowerCase()) {
    let char = raw;
    const d = DIGITS.indexOf(char);
    const ad = ARABIC_DIGITS.indexOf(char);
    if (d >= 0) char = String(d);
    else if (ad >= 0) char = String(ad);
    if (/[a-z0-9]/.test(char)) {
      flush();
      out += char;
    } else if (char === ' ' || char === '-' || char === '_' || char === '‌') {
      flush();
      out += '-';
    } else if (
      char in LETTERS ||
      char === 'و' ||
      char === 'ی' ||
      char === 'ي'
    ) {
      word += char;
    }
    // سایر نویسه‌ها (علامت‌ها، تطویل، اعراب) نادیده گرفته می‌شوند
  }
  flush();
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
    if (!(await isTaken(candidate)))
      return { slug: candidate, requestedAvailable: false };
  }
  return {
    slug: `${base.slice(0, 35)}-${randomSlugChars(4)}`,
    requestedAvailable: false,
  };
}
