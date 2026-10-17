// docs/DESIGN-structured-product-search-for-chat-agent.md بخش ۴ — اسکیمای ابزار search_products
// (ساخته‌شده از پروفایل داده‌ی هر فروشگاه) و نرمال‌سازی خروجی مدل به FinderSpec. مدل هیچ‌وقت SQL
// نمی‌نویسد؛ فقط همین شیء محدود را پر می‌کند و سرور آن را اعتبارسنجی می‌کند.
import { z } from 'zod';
import { toEnglishDigits } from '../../../common/utils/normalize-digits';

export const FINDER_DEFAULT_LIMIT = 5;
export const FINDER_MAX_LIMIT = 8;
export const FINDER_MAX_EXCLUDE = 20;
export const FINDER_MAX_ATTRIBUTES = 4;

export const SORT_KEYS = ['price', 'weight', 'wage', 'newest'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type FinderAttribute = { name?: string; value: string };

export interface FinderSpec {
  query?: string;
  minPrice?: number;
  maxPrice?: number;
  minWeightGrams?: number;
  maxWeightGrams?: number;
  maxWagePercent?: number;
  karat?: number;
  attributes?: FinderAttribute[];
  inStockOnly: boolean;
  sortBy?: SortKey;
  sortDir?: 'asc' | 'desc';
  excludeIds: string[];
  limit: number;
}

/** پروفایل داده‌ی واقعی یک فروشگاه؛ تعیین می‌کند کدام پارامترها به مدل نشان داده شوند */
export interface StoreSearchProfile {
  hasGold: boolean;
  hasWeight: boolean;
  catalogSize: number;
  optionVocab: { name: string; values: string[] }[];
  category: string | null;
}

/** پروفایل پیش‌فرض (وقتی پروفایل فروشگاه در دسترس نیست): همه‌ی پارامترها، بدون واژگان */
export const GENERIC_SEARCH_PROFILE: StoreSearchProfile = {
  hasGold: true,
  hasWeight: true,
  catalogSize: 0,
  optionVocab: [],
  category: null,
};

// ─── نرمال‌سازی متن ──────────────────────────────────────────────────────────────────────

export function normalizeFa(s: string): string {
  return toEnglishDigits(s)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‏‎]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set(
  [
    'دارید',
    'دارین',
    'داری',
    'دارم',
    'میخوام',
    'می‌خوام',
    'میخواستم',
    'میخوایم',
    'یه',
    'یک',
    'برای',
    'برا',
    'از',
    'در',
    'به',
    'با',
    'که',
    'این',
    'اون',
    'آن',
    'را',
    'رو',
    'هم',
    'و',
    'چیه',
    'چیست',
    'هست',
    'هستش',
    'لطفا',
    'لطفاً',
    'ممنون',
    'کدوم',
    'چی',
    'بدید',
    'بدین',
    'نشون',
    'نشان',
    'بهم',
    'من',
    'ما',
    'شما',
    'ها',
    'های',
  ].map(normalizeFa),
);

/** توکن‌های معنادار query: بدون کلمات بی‌اثر، با حذف جمع ساده‌ی «ها/های» */
export function tokenizeQuery(query: string): string[] {
  const out: string[] = [];
  for (const raw of normalizeFa(query).split(/[\s,،.؟?!:;()«»"'/\\-]+/)) {
    let t = raw;
    if (t.length > 4 && t.endsWith('های')) t = t.slice(0, -3);
    else if (t.length > 3 && t.endsWith('ها')) t = t.slice(0, -2);
    if (!t || STOPWORDS.has(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out.slice(0, 6);
}

// گروه‌های مترادف نام گزینه (ثابت کد، نه تنظیم)
const ATTR_SYNONYMS: string[][] = [
  ['رنگ', 'color', 'colour', 'رنگبندی', 'رنگ بندی'],
  ['سایز', 'اندازه', 'size', 'شماره', 'سایز کفش', 'سایز لباس'],
  ['جنس', 'material', 'متریال', 'نوع پارچه', 'پارچه'],
].map((g) => g.map(normalizeFa));

/** کلیدهای مجاز برای نام attribute؛ null یعنی نام ناشناخته → فقط تطبیق مقدار */
export function attributeKeyGroup(name: string | undefined): string[] | null {
  if (!name) return null;
  const n = normalizeFa(name);
  return ATTR_SYNONYMS.find((g) => g.includes(n)) ?? null;
}

/** نام واقعی گزینه‌ی فروشگاه با گروه مترادف جور است؟ (شمول، هم‌ارز شرط کلید در SQL) */
export function optionNameMatches(optionName: string, keys: string[]): boolean {
  const n = normalizeFa(optionName);
  return keys.some((k) => n.includes(k));
}

// ─── اسکیمای zod ابزار ───────────────────────────────────────────────────────────────────

// مدل گاهی عدد را رشته (حتی با رقم فارسی) می‌فرستد؛ در toFinderSpec به عدد تبدیل می‌شود
const numLike = z.union([z.number(), z.string()]);

const CATEGORY_EXAMPLES: Record<string, string> = {
  [normalizeFa('پوشاک')]:
    'مثال: «مشکی سایز ۴۲ زیر ۳ میلیون» → attributes:[{name:"رنگ",value:"مشکی"},{name:"سایز",value:"42"}], maxPrice:3000000.',
  [normalizeFa('کیف و کفش')]:
    'مثال: «مشکی سایز ۴۲ زیر ۳ میلیون» → attributes:[{name:"رنگ",value:"مشکی"},{name:"سایز",value:"42"}], maxPrice:3000000.',
};

export function buildSearchDescription(profile: StoreSearchProfile): string {
  const parts = [
    'جست‌وجو در کل کاتالوگ فعال فروشگاه با فیلتر و مرتب‌سازی دقیق (سمت سرور، نه حدس). ' +
      'برای هر سوال رتبه‌ای (ارزان‌ترین، سبک‌ترین، کمترین…) یا محدوده‌ای (زیر X، بالای Y، سایز/رنگ خاص) ' +
      'حتماً همین ابزار را با فیلتر/sortBy مربوط صدا بزن. ' +
      'برای پیام‌های نیازمحور (مثل «پیجم رشد نمی‌کنه») فقط query بده؛ اگر تطابقی نبود چند محصول کاتالوگ ' +
      'برگردانده می‌شود تا تناسب را خودت تشخیص بدهی.',
    'قیمت‌ها به تومان و عدد کامل‌اند (۳ میلیون = 3000000).',
  ];
  if (profile.hasGold) {
    parts.push(
      'مثال طلا: «زیر ۲ گرم با اجرت کمتر از ۱۰٪» → maxWeightGrams:2, maxWagePercent:10, sortBy:"wage".',
    );
  }
  const catEx = profile.category
    ? CATEGORY_EXAMPLES[normalizeFa(profile.category)]
    : undefined;
  if (catEx && profile.optionVocab.length) parts.push(catEx);
  parts.push(
    'نتیجه شامل catalog (کل محصولات)، matched (تعداد منطبق)، applied (فیلترهای اعمال‌شده) و sorted است. ' +
      'ادعای «ترین» فقط درباره‌ی بُعدی که با sorted آمده و فقط برای آیتم اول. matched=0 یعنی چنین محصولی نداریم.',
  );
  return parts.join(' ');
}

export function buildSearchInputSchema(profile: StoreSearchProfile) {
  const sortKeys = SORT_KEYS.filter(
    (k) =>
      (k !== 'weight' || profile.hasWeight) &&
      (k !== 'wage' || profile.hasGold),
  );
  const shape: Record<string, z.ZodType> = {
    query: z
      .string()
      .optional()
      .describe(
        'متن آزاد: نوع محصول، اسم یا کد (مثل «انگشتر»). نیاز مشتری هم می‌تواند باشد',
      ),
    minPrice: numLike.optional().describe('حداقل قیمت نهایی، تومان، عدد کامل'),
    maxPrice: numLike
      .optional()
      .describe('حداکثر قیمت نهایی، تومان، عدد کامل (۳ میلیون = 3000000)'),
    inStockOnly: z.boolean().optional().describe('فقط موجودها؛ پیش‌فرض true'),
    sortBy: z
      .enum(sortKeys as [SortKey, ...SortKey[]])
      .optional()
      .describe('مرتب‌سازی روی کل مجموعه‌ی منطبق'),
    sortDir: z
      .enum(['asc', 'desc'])
      .optional()
      .describe('پیش‌فرض asc (جز newest که desc است)'),
    // excludeIds عمداً به مدل نشان داده نمی‌شود (توکن)؛ سرور از ctx.lastSearch پر می‌کند
    nextPage: z
      .boolean()
      .optional()
      .describe(
        'برای «بعدی‌ها/بقیه‌اش/غیر از اینا/پایین‌تر»: true تا محصولاتی که قبلاً نشان داده شده کنار گذاشته شوند (همراه همان فیلترها)',
      ),
    limit: numLike
      .optional()
      .describe(
        `تعداد نتیجه؛ پیش‌فرض ${FINDER_DEFAULT_LIMIT}، حداکثر ${FINDER_MAX_LIMIT}`,
      ),
  };
  if (profile.hasWeight) {
    shape.minWeightGrams = numLike.optional().describe('حداقل وزن به گرم');
    shape.maxWeightGrams = numLike.optional().describe('حداکثر وزن به گرم');
  }
  if (profile.hasGold) {
    shape.maxWagePercent = numLike
      .optional()
      .describe('سقف اجرت مؤثر به درصد (فقط محصولات طلا)');
    shape.karat = numLike.optional().describe('عیار (۱۸، ۲۱، ۲۴…)');
  }
  if (profile.optionVocab.length) {
    const vocab = profile.optionVocab
      .map((o) => `${o.name}: ${o.values.join('، ')}`)
      .join(' ؛ ');
    shape.attributes = z
      .array(z.object({ name: z.string().optional(), value: z.string() }))
      .max(FINDER_MAX_ATTRIBUTES)
      .optional()
      .describe(
        `ویژگی/گزینه‌ی محصول (همه با AND، روی یک مدل واحد). مقدار را از واژگان واقعی فروشگاه بردار — ${vocab}`,
      );
  }
  return z.object(shape);
}

// ─── خروجی مدل → FinderSpec ──────────────────────────────────────────────────────────────

export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = toEnglishDigits(v)
    .replace(/[,٬\s]/g, '')
    .replace(/٫/g, '.');
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export interface SpecNotes {
  /** هشدارهایی که در applied/لاگ دیده می‌شوند (مثل maxPrice مشکوک به واحد اشتباه) */
  warnings: string[];
  /** مدل «صفحه‌ی بعد» خواسته؛ excludeIds را فراخوان از lastSearch پر می‌کند */
  nextPage: boolean;
}

/** ورودی خام ابزار → FinderSpec امن؛ پارامتر خارج از پروفایل فروشگاه حذف می‌شود */
export function toFinderSpec(
  raw: Record<string, unknown>,
  profile: StoreSearchProfile,
): { spec: FinderSpec; notes: SpecNotes } {
  const warnings: string[] = [];
  const pos = (v: unknown) => {
    const n = toNumber(v);
    return n !== undefined && n >= 0 ? n : undefined;
  };
  let minPrice = pos(raw.minPrice);
  let maxPrice = pos(raw.maxPrice);
  // سقف صفر یعنی مدل عدد را خراب فرستاده، نه «محصول رایگان»
  if (maxPrice === 0) maxPrice = undefined;
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  if (maxPrice !== undefined && maxPrice > 0 && maxPrice < 10_000) {
    warnings.push(
      `maxPrice=${maxPrice} (کمتر از ۱۰ هزار تومان؛ واحد تومان کامل است)`,
    );
  }
  let minW = profile.hasWeight ? pos(raw.minWeightGrams) : undefined;
  let maxW = profile.hasWeight ? pos(raw.maxWeightGrams) : undefined;
  if (minW !== undefined && maxW !== undefined && minW > maxW)
    [minW, maxW] = [maxW, minW];

  const attrs =
    profile.optionVocab.length && Array.isArray(raw.attributes)
      ? (raw.attributes as unknown[])
          .map((a): FinderAttribute | null => {
            if (!a || typeof a !== 'object') return null;
            const o = a as Record<string, unknown>;
            const value =
              typeof o.value === 'string' ? normalizeFa(o.value) : '';
            if (!value) return null;
            return {
              name: typeof o.name === 'string' ? o.name : undefined,
              value,
            };
          })
          .filter((a): a is FinderAttribute => !!a)
          .slice(0, FINDER_MAX_ATTRIBUTES)
      : [];

  let sortBy = SORT_KEYS.includes(raw.sortBy as SortKey)
    ? (raw.sortBy as SortKey)
    : undefined;
  if (sortBy === 'weight' && !profile.hasWeight) sortBy = undefined;
  if (sortBy === 'wage' && !profile.hasGold) sortBy = undefined;
  const sortDir =
    raw.sortDir === 'asc' || raw.sortDir === 'desc' ? raw.sortDir : undefined;

  const limitN = toNumber(raw.limit);
  const limit = Math.min(
    FINDER_MAX_LIMIT,
    Math.max(1, Math.floor(limitN ?? FINDER_DEFAULT_LIMIT)),
  );
  const query =
    typeof raw.query === 'string' && raw.query.trim()
      ? raw.query.trim()
      : undefined;
  const karat = profile.hasGold ? pos(raw.karat) : undefined;
  const maxWagePercent = profile.hasGold ? pos(raw.maxWagePercent) : undefined;

  return {
    spec: {
      query,
      minPrice,
      maxPrice,
      minWeightGrams: minW,
      maxWeightGrams: maxW,
      maxWagePercent,
      karat: karat ? Math.round(karat) : undefined,
      attributes: attrs.length ? attrs : undefined,
      inStockOnly: raw.inStockOnly === false ? false : true,
      sortBy,
      sortDir,
      excludeIds: Array.isArray(raw.excludeIds)
        ? (raw.excludeIds as unknown[])
            .filter((x): x is string => typeof x === 'string')
            .slice(0, FINDER_MAX_EXCLUDE)
        : [],
      limit,
    },
    notes: { warnings, nextPage: raw.nextPage === true },
  };
}

/** فقط query آمده (بدون هیچ فیلتر یا مرتب‌سازی)؟ → رفتار قدیمی مشاوره‌ای حفظ می‌شود (بخش ۴.۱) */
export function isQueryOnly(spec: FinderSpec): boolean {
  return (
    spec.minPrice === undefined &&
    spec.maxPrice === undefined &&
    spec.minWeightGrams === undefined &&
    spec.maxWeightGrams === undefined &&
    spec.maxWagePercent === undefined &&
    spec.karat === undefined &&
    !spec.attributes &&
    !spec.sortBy &&
    spec.inStockOnly &&
    spec.excludeIds.length === 0
  );
}

export type AppliedFilters = {
  [key: string]: string | number | boolean | FinderAttribute[];
};

/** فیلترهای اعمال‌شده برای نمایش به مدل (applied) */
export function appliedOf(spec: FinderSpec): AppliedFilters {
  const o: AppliedFilters = {};
  if (spec.query) o.query = spec.query;
  for (const k of [
    'minPrice',
    'maxPrice',
    'minWeightGrams',
    'maxWeightGrams',
    'maxWagePercent',
    'karat',
  ] as const) {
    if (spec[k] !== undefined) o[k] = spec[k];
  }
  if (spec.attributes) o.attributes = spec.attributes;
  o.inStockOnly = spec.inStockOnly;
  return o;
}

export function sortLabel(spec: FinderSpec): string | null {
  if (!spec.sortBy) return null;
  const dir = spec.sortDir ?? (spec.sortBy === 'newest' ? 'desc' : 'asc');
  return `${spec.sortBy} ${dir}`;
}
