// docs/DESIGN-structured-product-search-for-chat-agent.md بخش ۳ — کوئری «واحد قابل‌فروش».
// فقط Prisma.sql با پارامتر؛ کلید مرتب‌سازی از whitelist می‌آید و هیچ رشته‌ای از ورودی مستقیم در
// SQL الحاق نمی‌شود.
import { Prisma } from '@prisma/client';
import { buildGoldPriceSql } from './gold-price-linear';
import {
  attributeKeyGroup,
  tokenizeQuery,
  type FinderSpec,
  type SortKey,
} from './finder-spec';

export interface FinderRow {
  productId: string;
  variantId: string | null;
  opts: Record<string, string> | null;
  price: number | null;
  w: number | null;
  k: number | null;
  wagePct: number | null;
  isGold: boolean;
  wageApprox: boolean;
  inStock: boolean;
}

export interface FinderQueryResult {
  rows: FinderRow[];
  totalMatched: number;
  totalCatalog: number;
  unpricedCount: number;
}

// نرمال‌سازی سمت SQL هم‌ارز normalizeFa: ارقام فارسی/عربی، ی/ک عربی، نیم‌فاصله → فاصله
const norm = (expr: string) =>
  `lower(translate(${expr}, 'يك‌۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', 'یک 01234567890123456789'))`;

const SORT_SQL: Record<
  SortKey,
  { col: Prisma.Sql; defaultDir: 'asc' | 'desc' }
> = {
  price: { col: Prisma.sql`price`, defaultDir: 'asc' },
  weight: { col: Prisma.sql`w`, defaultDir: 'asc' },
  wage: { col: Prisma.sql`wage_pct`, defaultDir: 'asc' },
  newest: { col: Prisma.sql`created_at`, defaultDir: 'desc' },
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
const isNumeric = (s: string) => /^\d+(\.\d+)?$/.test(s);

function orderBy(spec: FinderSpec): { sql: Prisma.Sql; unit: Prisma.Sql } {
  const s = SORT_SQL[spec.sortBy ?? 'newest'];
  const dir =
    (spec.sortDir ?? s.defaultDir) === 'desc'
      ? Prisma.sql`DESC`
      : Prisma.sql`ASC`;
  // tie-breaker ثابت: نتیجه‌ی یک سوال در دو بار پرسیدن عوض نشود
  const key = Prisma.sql`${s.col} ${dir} NULLS LAST, created_at DESC`;
  return {
    sql: Prisma.sql`${key}, product_id`,
    // انتخاب بهترین واحد هر محصول: همان کلید؛ بدون sortBy موجود و ارزان‌تر اول
    unit: spec.sortBy
      ? Prisma.sql`${s.col} ${dir} NULLS LAST, in_stock DESC, price ASC NULLS LAST, variant_id`
      : Prisma.sql`in_stock DESC, price ASC NULLS LAST, variant_id`,
  };
}

function tokenCond(token: string): Prisma.Sql {
  if (isNumeric(token)) {
    // «42» نباید با «142» جور شود
    return Prisma.sql`hay ~ ${`(^|[^0-9.])${token.replace('.', '\\.')}([^0-9]|$)`}`;
  }
  return Prisma.sql`hay LIKE ${`%${escapeLike(token)}%`}`;
}

function attributeCond(a: { name?: string; value: string }): Prisma.Sql {
  const keys = attributeKeyGroup(a.name);
  // شمول نه برابری: فروشنده اسم گزینه را آزاد می‌نویسد («سایز پا»، «شماره کفش»، «رنگ بدنه»)
  const keyCond = keys
    ? Prisma.sql`AND EXISTS (SELECT 1 FROM unnest(${keys}::text[]) AS t WHERE split_part(pair, '‖', 1) LIKE '%' || t || '%')`
    : Prisma.empty;
  const val = Prisma.sql`split_part(pair, '‖', 2)`;
  const valCond =
    isNumeric(a.value) || a.value.length < 3
      ? Prisma.sql`${val} = ${a.value}`
      : Prisma.sql`${val} LIKE ${`%${escapeLike(a.value)}%`}`;
  return Prisma.sql`EXISTS (SELECT 1 FROM unnest(pairs) AS pair WHERE ${valCond} ${keyCond})`;
}

export function buildFinderQuery(
  storeId: string,
  spec: FinderSpec,
  g18: number | null,
): Prisma.Sql {
  const gold = buildGoldPriceSql(g18);
  const ord = orderBy(spec);

  // شرط‌های غیرقیمتی جدا نگه داشته می‌شوند تا unpriced فقط واحدهای منطبقِ بی‌قیمت را بشمارد
  const conds: Prisma.Sql[] = [];
  const priceConds: Prisma.Sql[] = [];
  if (spec.inStockOnly) conds.push(Prisma.sql`in_stock`);
  if (spec.minPrice !== undefined)
    priceConds.push(
      Prisma.sql`price IS NOT NULL AND price >= ${spec.minPrice}`,
    );
  if (spec.maxPrice !== undefined)
    priceConds.push(
      Prisma.sql`price IS NOT NULL AND price <= ${spec.maxPrice}`,
    );
  if (spec.minWeightGrams !== undefined)
    conds.push(Prisma.sql`w IS NOT NULL AND w >= ${spec.minWeightGrams}`);
  if (spec.maxWeightGrams !== undefined)
    conds.push(Prisma.sql`w IS NOT NULL AND w <= ${spec.maxWeightGrams}`);
  if (spec.maxWagePercent !== undefined)
    conds.push(
      Prisma.sql`wage_pct IS NOT NULL AND wage_pct <= ${spec.maxWagePercent}`,
    );
  if (spec.karat !== undefined) conds.push(Prisma.sql`k = ${spec.karat}`);
  if (spec.query) {
    for (const t of tokenizeQuery(spec.query)) conds.push(tokenCond(t));
  }
  for (const a of spec.attributes ?? []) conds.push(attributeCond(a));
  const nonPriceWhere = conds.length
    ? Prisma.join(conds, ' AND ')
    : Prisma.sql`TRUE`;
  const where = priceConds.length
    ? Prisma.sql`${nonPriceWhere} AND ${Prisma.join(priceConds, ' AND ')}`
    : nonPriceWhere;
  const exclude = spec.excludeIds.length ? spec.excludeIds : [];

  return Prisma.sql`
WITH p AS (
  SELECT pr.id, pr.name, pr.code, pr.specs, pr."createdAt" AS created_at,
         pr."pricingModel" = 'WEIGHT_BASED_FORMULA' AS is_gold,
         pr."basePrice" AS base_price, pr."weightGrams" AS p_weight, pr."purityKarat" AS p_karat,
         pr."trackStock" AS track_stock, pr.stock AS p_stock,
         COALESCE(pr."goldWageType", s."goldWageType")           AS wage_type,
         COALESCE(pr."goldWageValue", s."goldWageValue")         AS wage_value,
         COALESCE(pr."goldProfitPercent", s."goldProfitPercent") AS profit_pct,
         s."goldVatPercent"                                      AS vat_pct,
         EXISTS (SELECT 1 FROM product_option_types ot WHERE ot."productId" = pr.id) AS has_opts,
         ARRAY(
           SELECT ${Prisma.raw(norm("e->>'label'"))} || '‖' || ${Prisma.raw(norm("e->>'value'"))}
           FROM jsonb_array_elements(CASE WHEN jsonb_typeof(pr.specs) = 'array' THEN pr.specs ELSE '[]'::jsonb END) e
           WHERE e->>'value' IS NOT NULL
         ) AS spec_pairs
  FROM products pr JOIN stores s ON s.id = pr."storeId"
  WHERE pr."storeId" = ${storeId} AND pr.status = 'ACTIVE'
),
unit AS (
  SELECT p.id AS product_id, v.id AS variant_id, v."optionValues" AS opts,
         COALESCE(v."weightGrams", p.p_weight) AS w,
         COALESCE(v."purityKarat", p.p_karat) AS k,
         COALESCE(v."priceOverride", p.base_price)::double precision AS fixed_price,
         (NOT p.track_stock OR v.stock > 0) AS in_stock,
         p.name, p.code, p.created_at, p.is_gold, p.wage_type, p.wage_value, p.profit_pct, p.vat_pct,
         p.spec_pairs
           || ARRAY(SELECT ${Prisma.raw(norm('key'))} || '‖' || ${Prisma.raw(norm('value'))} FROM jsonb_each_text(v."optionValues")) AS pairs
  FROM p JOIN product_variants v ON v."productId" = p.id
  WHERE p.has_opts
  UNION ALL
  SELECT p.id, NULL, NULL, p.p_weight, p.p_karat, p.base_price::double precision,
         (NOT p.has_opts AND (NOT p.track_stock OR p.p_stock > 0)),
         p.name, p.code, p.created_at, p.is_gold, p.wage_type, p.wage_value, p.profit_pct, p.vat_pct,
         p.spec_pairs
  FROM p
  WHERE NOT p.has_opts OR NOT EXISTS (SELECT 1 FROM product_variants v WHERE v."productId" = p.id)
),
priced AS (
  SELECT unit.*,
         ${Prisma.raw(norm('name'))} || ' ' || ${Prisma.raw(norm("COALESCE(code, '')"))} || ' ' ||
           COALESCE((SELECT string_agg(split_part(x, '‖', 2), ' ') FROM unnest(pairs) x), '') AS hay,
         (CASE WHEN is_gold THEN ${gold.price} ELSE fixed_price END) AS price,
         (CASE WHEN is_gold THEN ${gold.wagePct} END) AS wage_pct
  FROM unit
),
matched AS (SELECT * FROM priced WHERE ${where}),
best AS (
  SELECT DISTINCT ON (product_id) * FROM matched
  ORDER BY product_id, ${ord.unit}
),
page AS (
  SELECT b.*, row_number() OVER (ORDER BY ${ord.sql}) AS rn
  FROM best b
  WHERE NOT (b.product_id = ANY(${exclude}::text[]))
  ORDER BY ${ord.sql}
  LIMIT ${spec.limit}
)
SELECT (SELECT COUNT(*) FROM best)::int AS total_matched,
       (SELECT COUNT(*) FROM p)::int AS total_catalog,
       (SELECT COUNT(DISTINCT product_id) FROM priced WHERE price IS NULL AND ${nonPriceWhere})::int AS unpriced,
       pg.product_id, pg.variant_id, pg.opts, pg.price, pg.w, pg.k, pg.wage_pct, pg.is_gold,
       (pg.is_gold AND pg.wage_type = 'FIXED_PER_GRAM') AS wage_approx, pg.in_stock
FROM (SELECT 1) one LEFT JOIN page pg ON TRUE
ORDER BY pg.rn NULLS LAST`;
}

type RawRow = {
  total_matched: number;
  total_catalog: number;
  unpriced: number;
  product_id: string | null;
  variant_id: string | null;
  opts: Record<string, string> | null;
  price: number | null;
  w: number | null;
  k: number | null;
  wage_pct: number | null;
  is_gold: boolean | null;
  wage_approx: boolean | null;
  in_stock: boolean | null;
};

export function mapFinderRows(raw: RawRow[]): FinderQueryResult {
  const head = raw[0];
  return {
    totalMatched: head?.total_matched ?? 0,
    totalCatalog: head?.total_catalog ?? 0,
    unpricedCount: head?.unpriced ?? 0,
    rows: raw
      .filter((r) => r.product_id)
      .map((r) => ({
        productId: r.product_id as string,
        variantId: r.variant_id,
        opts: r.opts,
        price: r.price,
        w: r.w,
        k: r.k,
        wagePct: r.wage_pct,
        isGold: !!r.is_gold,
        wageApprox: !!r.wage_approx,
        inStock: !!r.in_stock,
      })),
  };
}
