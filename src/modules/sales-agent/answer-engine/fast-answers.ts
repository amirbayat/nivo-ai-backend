import { createHash } from 'crypto';
import type { AceIntent } from './signature';

// ACE-10 — جواب ترکیبی: عدد زنده از DB + متن فروش آماده‌ی محصول (پیچ از برگه‌ی ACE-16). خالص.
export interface Pitch {
  benefits: string[];
  valueLines: string[];
  followUps: string[];
  openers: string[];
}

export interface PriceRange { min: number; max: number }

const fmt = (n: number) => n.toLocaleString('fa-IR');
export const formatPrice = (r: PriceRange): string =>
  r.min === r.max ? `${fmt(r.min)} تومان` : `از ${fmt(r.min)} تا ${fmt(r.max)} تومان`;

// انتخاب چرخشی ولی قطعی (برای تست‌پذیری): seed ثابت → همان انتخاب
function pick<T>(arr: T[], seed: string, salt: string, avoid: Set<T> = new Set()): T | undefined {
  const pool = arr.filter((x) => !avoid.has(x));
  const list = pool.length ? pool : arr;
  if (!list.length) return undefined;
  const h = createHash('sha1').update(`${seed}|${salt}`).digest().readUInt32BE(0);
  return list[h % list.length];
}

export interface ComposeInput {
  intent: AceIntent;
  productName: string;
  price: PriceRange;
  inStock: boolean;
  pitch: Pitch | null;
  seed: string; // مثلاً conversationId
  usedLines?: string[]; // در این گفتگو قبلاً استفاده شده
  urgentDiscountLine?: string | null; // خط موجود تخفیف فوری (متن آماده، نه ساخته‌ی ما)
}

export interface Composed { text: string; usedLines: string[] }

// فقط ASK_PRICE و STOCK_CHECK؛ پیچ ناقص (< ۲ benefit) → null (جواب را LLM بدهد)
export function composeFastAnswer(i: ComposeInput): Composed | null {
  if (!i.pitch || i.pitch.benefits.length < 2) return null;
  if (i.intent !== 'ASK_PRICE' && i.intent !== 'STOCK_CHECK') return null;
  const avoid = new Set(i.usedLines ?? []);
  const benefit = pick(i.pitch.benefits, i.seed, 'b', avoid);
  const value = pick(i.pitch.valueLines, i.seed, 'v', avoid);
  const followUp = pick(i.pitch.followUps, i.seed, 'f');
  const opener = pick(i.pitch.openers, i.seed, 'o');
  if (!benefit) return null;
  const used = [benefit, ...(value && i.intent === 'ASK_PRICE' ? [value] : [])];
  const parts: string[] = [];
  if (i.intent === 'ASK_PRICE') {
    parts.push(`${opener ? `${opener} ` : ''}${i.productName} الان ${formatPrice(i.price)} است.`);
    if (i.urgentDiscountLine) parts.push(i.urgentDiscountLine);
    parts.push(`${benefit}${value ? `؛ ${value}` : ''}.`);
  } else {
    parts.push(i.inStock ? `${i.productName} موجود است.` : `${i.productName} فعلاً ناموجود است.`);
    if (i.inStock) parts.push(`${benefit}.`);
  }
  if (followUp && i.inStock) parts.push(followUp);
  return { text: parts.join(' ').replace(/\s+/g, ' ').trim(), usedLines: used };
}

// قابل‌قبول بودن پیام برای جواب قطعی (بند ۱۰ شروط عمومی)
export function eligibleForFastAnswer(i: { intent: AceIntent; negated: boolean; wordCount: number; scope: string }): boolean {
  return (i.intent === 'ASK_PRICE' || i.intent === 'STOCK_CHECK') && !i.negated && i.wordCount <= 8 && i.scope.startsWith('p:');
}
