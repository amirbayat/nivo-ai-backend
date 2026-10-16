import { COMMON_ITEMS, VAGUE_PHRASES, getProductQualityGuide, type QualityGuideItem } from './product-quality-guides';

// PQ-1 — لایه‌ی قاعده‌ای: تابع خالص، رایگان و فوری. فقط ok|unknown (missing قطعی با LLM)
export interface QualityReviewProductInput {
  name: string;
  description: string | null;
  specs?: unknown;
  imageCount: number;
  category: string | null;
  optionTypes?: { name: string; values: string[] }[];
}

export type RuleItemStatus = 'ok' | 'unknown';
export interface RuleReview {
  items: { key: string; label: string; status: RuleItemStatus }[];
}

const MIN_DESC_CHARS = 150;
const MIN_PHOTOS = 3;

// ی/ک عربی و فاصله‌ی اضافه را یکی می‌کند تا تطبیق کلیدواژه کمتر خطا کند
export function normalizeFa(s: string): string {
  return s.replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').toLowerCase();
}

function specsText(specs: unknown): string {
  if (!specs || typeof specs !== 'object') return '';
  const parts: string[] = [];
  const walk = (v: unknown, key?: string) => {
    if (key) parts.push(key);
    if (typeof v === 'string' || typeof v === 'number') parts.push(String(v));
    else if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(specs);
  return parts.join(' ');
}

export function ruleReview(product: QualityReviewProductInput, guide: QualityGuideItem[] = getProductQualityGuide(product.category)): RuleReview {
  const options = product.optionTypes ?? [];
  const haystack = normalizeFa(
    [product.name, product.description ?? '', specsText(product.specs), ...options.flatMap((o) => [o.name, ...o.values])].join(' '),
  );
  const text = normalizeFa(`${product.name} ${product.description ?? ''}`);
  const items = guide.map((g): { key: string; label: string; status: RuleItemStatus } => {
    let ok: boolean;
    switch (g.key) {
      case 'name':
        ok = product.name.trim().split(/\s+/).length >= 2;
        break;
      case 'desc_length':
        ok = (product.description?.trim().length ?? 0) >= MIN_DESC_CHARS;
        break;
      case 'photos':
        ok = product.imageCount >= MIN_PHOTOS;
        break;
      case 'no_vague':
        ok = !VAGUE_PHRASES.some((p) => text.includes(normalizeFa(p)));
        break;
      default:
        ok = g.detect.some((d) => haystack.includes(normalizeFa(d)));
    }
    return { key: g.key, label: g.label, status: ok ? 'ok' : 'unknown' };
  });
  return { items };
}

export { COMMON_ITEMS };
