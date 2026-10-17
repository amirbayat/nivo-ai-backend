// docs/DESIGN-structured-product-search-for-chat-agent.md بخش ۵ — قیمت طلا نسبت به نرخ هر گرم
// طلای ۱۸ (G) خطی است، پس می‌شود داخل SQL دقیق حساب کرد و روی کل کاتالوگ فیلتر/مرتب کرد.
// این فایل تنها منبع ضرایب است: SQL از buildGoldPriceSql می‌سازد و تست یکسانی
// (gold-price-linear.spec.ts) خروجی linearGoldPrice را با computeDisplayPrice مقایسه می‌کند.
//
//   base = W · (K/18) · G
//   PERCENT (اجرت w):        final = base · [1 + (1+v)(w + p + w·p)]
//   FIXED_PER_GRAM (اجرت f): final = base · [1 + (1+v)·p] + f·W·(1+p)(1+v)
//   قیمت نهایی = round(final / 1000) · 1000
import { Prisma } from '@prisma/client';

export const GOLD_ROUND_TO_TOMAN = 1000;

export type GoldWage = { type: 'PERCENT' | 'FIXED_PER_GRAM'; value: number };

/** نسخه‌ی TS همان فرمول SQL؛ ورودی‌ها اجرت/سود/مالیات به درصد (مثل DB) */
export function linearGoldPrice(args: {
  weightGrams: number;
  purityKarat: number;
  wage: GoldWage;
  profitPercent: number;
  vatPercent: number;
  gold18PerGram: number;
}): number {
  const { weightGrams: W, purityKarat: K, wage, gold18PerGram: G } = args;
  const p = args.profitPercent / 100;
  const v = args.vatPercent / 100;
  const base = W * (K / 18) * G;
  const final =
    wage.type === 'PERCENT'
      ? base * (1 + (1 + v) * (wage.value / 100 + p + (wage.value / 100) * p))
      : base * (1 + (1 + v) * p) + wage.value * W * (1 + p) * (1 + v);
  return Math.round(final / GOLD_ROUND_TO_TOMAN) * GOLD_ROUND_TO_TOMAN;
}

/** اجرت مؤثر به درصدِ ارزش خام طلا (برای FIXED_PER_GRAM تقریبی است) */
export function effectiveWagePercent(args: {
  purityKarat: number;
  wage: GoldWage;
  gold18PerGram: number;
}): number {
  if (args.wage.type === 'PERCENT') return args.wage.value;
  return (
    (args.wage.value / ((args.purityKarat / 18) * args.gold18PerGram)) * 100
  );
}

/**
 * عبارت‌های SQL قیمت و اجرت مؤثر روی ستون‌های CTE `unit` (w, k, wage_type, wage_value,
 * profit_pct, vat_pct). `g18` پارامتر نرخ ۱۸ است (NULL = نرخ در دسترس نیست). هیچ مقداری از
 * ورودی کاربر داخل رشته الحاق نمی‌شود.
 */
export function buildGoldPriceSql(g18: number | null): {
  price: Prisma.Sql;
  wagePct: Prisma.Sql;
} {
  const ok = Prisma.sql`(w IS NOT NULL AND w > 0 AND k IS NOT NULL AND k > 0
      AND wage_type IS NOT NULL AND wage_value IS NOT NULL AND profit_pct IS NOT NULL
      AND ${g18}::double precision IS NOT NULL)`;
  const base = Prisma.sql`(w * (k::double precision / 18) * ${g18}::double precision)`;
  const p = Prisma.sql`(profit_pct / 100)`;
  const v = Prisma.sql`(vat_pct / 100)`;
  const wf = Prisma.sql`(wage_value / 100)`;
  const raw = Prisma.sql`(CASE WHEN wage_type = 'PERCENT'
      THEN ${base} * (1 + (1 + ${v}) * (${wf} + ${p} + ${wf} * ${p}))
      ELSE ${base} * (1 + (1 + ${v}) * ${p}) + wage_value * w * (1 + ${p}) * (1 + ${v}) END)`;
  return {
    // floor(x+0.5) = round-half-up مثل Math.round (round() خود Postgres روی double به‌زوج گرد می‌کند)
    price: Prisma.sql`(CASE WHEN ${ok}
      THEN floor(${raw} / ${GOLD_ROUND_TO_TOMAN} + 0.5) * ${GOLD_ROUND_TO_TOMAN} END)`,
    wagePct: Prisma.sql`(CASE WHEN ${ok} THEN
      (CASE WHEN wage_type = 'PERCENT' THEN wage_value
        ELSE wage_value / ((k::double precision / 18) * ${g18}::double precision) * 100 END) END)`,
  };
}
