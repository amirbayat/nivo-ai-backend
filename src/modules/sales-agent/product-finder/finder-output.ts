// docs/DESIGN-structured-product-search-for-chat-agent.md بخش ۶ — خروجی فشرده‌ی ابزار، حافظه‌ی
// پیگیری و قواعد پرامپت. توابع خالص؛ I/O (واکشی محصول، resolveProductPrices) در engine است.
import {
  FINDER_MAX_EXCLUDE,
  appliedOf,
  type AppliedFilters,
  attributeKeyGroup,
  normalizeFa,
  optionNameMatches,
  sortLabel,
  type FinderSpec,
  type StoreSearchProfile,
} from './finder-spec';
import type { FinderRow } from './finder-sql';

// type (نه interface) تا به JSON ستون contextData assignable باشد
export type LastSearch = {
  /** epoch ms؛ خط پرامپت فقط تا LAST_SEARCH_PROMPT_TTL_MS بعد از آن آورده می‌شود */
  at?: number;
  applied: AppliedFilters;
  sorted: string | null;
  matched: number;
  shownIds: string[];
};

export interface FinderItem {
  id: string;
  name: string;
  price: number | null;
  inStock: boolean;
  variant?: string;
  weightGrams?: number;
  wagePercent?: number;
  wageApprox?: true;
  karat?: number;
}

/** قیمت SQL و قیمت TS (منبع حقیقت) را با تلورانس گردکردن مقایسه می‌کند */
export function priceMismatch(
  sqlPrice: number | null,
  tsPrice: number,
): boolean {
  return sqlPrice !== null && Math.abs(sqlPrice - tsPrice) > 1000;
}

export function buildFinderItem(
  row: FinderRow,
  product: { id: string; name: string },
  tsPrice: number,
  spec: FinderSpec,
): FinderItem {
  const item: FinderItem = {
    id: product.id,
    name: product.name,
    // قیمت SQL فقط برای رتبه‌بندی است؛ آنچه به مدل/مشتری می‌رسد همان مقدار TS است. واحدی که
    // قیمتش در SQL نامعلوم بود (نرخ طلا/تنظیمات ناقص) حدس زده نمی‌شود
    price: row.price === null ? null : tsPrice,
    inStock: row.inStock,
  };
  if (row.opts) item.variant = Object.values(row.opts).join(' / ');
  if (
    (spec.sortBy === 'weight' ||
      spec.minWeightGrams !== undefined ||
      spec.maxWeightGrams !== undefined) &&
    row.w !== null
  ) {
    item.weightGrams = row.w;
  }
  if (
    (spec.sortBy === 'wage' || spec.maxWagePercent !== undefined) &&
    row.wagePct !== null
  ) {
    item.wagePercent = Math.round(row.wagePct * 10) / 10;
    if (row.wageApprox) item.wageApprox = true;
  }
  if (spec.karat !== undefined && row.k !== null) item.karat = row.k;
  return item;
}

/** وقتی attribute صفر نتیجه داد، واژگان واقعی همان گزینه را می‌دهد تا مدل بپرسد */
export function buildZeroHint(
  spec: FinderSpec,
  profile: StoreSearchProfile,
): string | undefined {
  if (!spec.attributes) return undefined;
  const lines: string[] = [];
  for (const a of spec.attributes) {
    const keys = attributeKeyGroup(a.name);
    const vocab = profile.optionVocab.find((o) =>
      keys
        ? optionNameMatches(o.name, keys)
        : a.name
          ? normalizeFa(o.name) === normalizeFa(a.name)
          : false,
    );
    if (vocab && !vocab.values.some((v) => normalizeFa(v) === a.value)) {
      lines.push(
        `«${a.value}» برای ${vocab.name} نداریم؛ مقادیر موجود: ${vocab.values.join('، ')}`,
      );
    }
  }
  return lines.length ? lines.join('؛ ') : undefined;
}

export function buildLastSearch(
  spec: FinderSpec,
  matched: number,
  shown: string[],
): LastSearch {
  const ids = [...new Set([...spec.excludeIds, ...shown])].slice(
    -FINDER_MAX_EXCLUDE,
  );
  return {
    at: Date.now(),
    applied: appliedOf(spec),
    sorted: sortLabel(spec),
    matched,
    shownIds: ids,
  };
}

export const LAST_SEARCH_PROMPT_TTL_MS = 30 * 60 * 1000;

/** یک خط واقعیت برای نوبت بعد: «پایین‌تر ندارید؟» مرجع دارد. شناسه‌ها عمداً نمی‌آیند (توکن) */
export function describeLastSearch(
  ls: LastSearch | null | undefined,
  now: number = Date.now(),
): string | null {
  // رکورد قدیمی بدون at یا جست‌وجوی کهنه: احتمالاً موضوع عوض شده
  if (!ls?.at || now - ls.at > LAST_SEARCH_PROMPT_TTL_MS) return null;
  return (
    `آخرین جست‌وجوی ساختاریافته: فیلترها ${JSON.stringify(ls.applied)}` +
    `${ls.sorted ? `، مرتب بر ${ls.sorted}` : ''}، ${ls.matched} نتیجه‌ی منطبق، ${ls.shownIds.length} تا نشان داده شده. ` +
    'برای «پایین‌تر/ارزان‌تر/بعدی‌ها/بقیه‌اش» همین فیلترها را با تغییر لازم و nextPage: true دوباره جست‌وجو کن.'
  );
}

/** شناسه‌هایی که با nextPage کنار گذاشته می‌شوند */
export function nextPageExcludeIds(
  ls: LastSearch | null | undefined,
): string[] {
  return ls?.shownIds.slice(-FINDER_MAX_EXCLUDE) ?? [];
}

// بلوک کوتاه ثابت (قبل از PROMPT_CACHE_BREAK تا در کش بماند)
export const STRUCTURED_SEARCH_RULES = `قواعد جست‌وجوی دقیق محصول:
- سوال رتبه‌ای یا محدوده‌ای (کمترین، بیشترین، ارزان‌ترین، سبک‌ترین، زیر X، بالای Y، سایز یا رنگ خاص) ← search_products را با فیلتر یا sortBy مربوط صدا بزن. از «چند نمونه از محصولات» یا نتیجه‌ی قبلی نتیجه‌ی رتبه‌ای نگیر.
- صفت عالی («ترین») فقط درباره‌ی بُعدی که با sorted در نتیجه آمده و فقط برای آیتم اول مجاز است.
- matched = 0 یعنی چنین محصولی نداریم؛ بگو نداریم. اگر خواستی تعدیل پیشنهاد بدهی، یک جست‌وجوی دوم با فقط یک فیلتر شل‌تر بزن و فقط نتیجه‌ی همان را بگو.
- از catalog و matched برای جمله‌ی صادقانه استفاده کن («از ۲۵۰ محصول، ۴۱ تا منطبق‌اند»). تعداد موجودی انبار را هرگز نگو.
- price: null یعنی قیمت فعلاً قابل‌محاسبه نیست؛ عدد حدس نزن.`;
