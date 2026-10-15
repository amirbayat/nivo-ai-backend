import { toEnglishDigits } from './normalize-digits';

// R1.4 — پارسر مبلغ فارسی مشترک. خروجی همیشه «تومان» است. فقط وقتی عدد به‌صراحت مبلغ باشد
// (بعدش «تومان/تومن/ریال» یا «هزار/میلیون/میلیارد») شمرده می‌شود؛ «۱۲۰۰ گرم» و «سایز ۴۲» مبلغ نیستند.
// نکته: عدد حروفی («چهارصد و پنجاه هزار») پشتیبانی نمی‌شود (TODO(product) اگر مدل‌ها این‌طور نوشتند).

const MULTIPLIERS: Record<string, number> = {
  هزار: 1_000,
  میلیون: 1_000_000,
  ملیون: 1_000_000,
  میلیارد: 1_000_000_000,
};

const AMOUNT_RE =
  /(\d+(?:\.\d+)?)\s*(میلیارد|میلیون|ملیون|هزار)?\s*(تومان|تومن|ریال)?/g;

interface RawAmount {
  start: number;
  end: number;
  value: number;
  mult: number;
}

function normalize(text: string): string {
  return (
    toEnglishDigits(text)
      // ی/ک عربی و حروف کشیده
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/ـ/g, '')
      // اعشار فارسی (٫) و اسلش بین دو رقم ← نقطه؛ جداکننده‌ی هزارگان (، , ٬) بین ارقام حذف
      .replace(/(\d)[٫/](?=\d)/g, '$1.')
      .replace(/(\d)[,٬،](?=\d{3}(?!\d))/g, '$1')
      .replace(/(\d)[,٬،](?=\d{3}(?!\d))/g, '$1')
      // نیم‌فاصله و فاصله‌ی غیرمعمول ← فاصله
      .replace(/[‌ ]/g, ' ')
  );
}

export function parseFaAmounts(text: string): number[] {
  if (!text) return [];
  const t = normalize(text);
  const raw: RawAmount[] = [];
  for (const m of t.matchAll(AMOUNT_RE)) {
    const unit = m[2];
    const currency = m[3];
    if (!unit && !currency) continue;
    const mult = unit ? MULTIPLIERS[unit] : 1;
    let value = Number(m[1]) * mult;
    if (currency === 'ریال') value = value / 10;
    if (!Number.isFinite(value)) continue;
    raw.push({
      start: m.index!,
      end: m.index! + m[0].length,
      value: Math.round(value),
      mult: currency === 'ریال' ? mult / 10 : mult,
    });
  }
  // «۲ میلیون و ۵۰۰ هزار تومان» یک مبلغ است (۲٬۵۰۰٬۰۰۰)، نه دو مبلغ جدا
  const merged: number[] = [];
  let prev: RawAmount | null = null;
  let total = 0;
  const flush = () => {
    if (prev) merged.push(total);
  };
  for (const cur of raw) {
    if (
      prev &&
      /^\s*و\s*$/.test(t.slice(prev.end, cur.start)) &&
      prev.mult > cur.mult
    ) {
      total += cur.value;
      prev = { ...cur, mult: cur.mult };
      continue;
    }
    flush();
    prev = cur;
    total = cur.value;
  }
  flush();
  return merged;
}

export function findUnauthorizedAmounts(
  text: string,
  allowed: ReadonlySet<number>,
): number[] {
  return [...new Set(parseFaAmounts(text).filter((a) => !allowed.has(a)))];
}

// جمله‌ی حاوی مبلغ غیرمجاز حذف می‌شود؛ اگر حذفی شد یک خط «قیمت دقیق روی کارت محصول» اضافه می‌شود
export function stripUnauthorizedPriceSentences(
  text: string,
  allowed: ReadonlySet<number>,
  seeCardLine: string,
): { text: string; changed: boolean } {
  const parts = text.split(/(?<=[.!؟?\n])\s+/);
  const kept = parts.filter(
    (sentence) => findUnauthorizedAmounts(sentence, allowed).length === 0,
  );
  if (kept.length === parts.length) return { text, changed: false };
  return { text: [...kept, seeCardLine].join(' ').trim(), changed: true };
}
