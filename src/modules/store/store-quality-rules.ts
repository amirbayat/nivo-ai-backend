import { VAGUE_PHRASES } from './product-quality-guides';
import { normalizeFa } from './product-quality-rules';
import { getStoreQualityGuide, type StoreQualityItem } from './store-quality-guides';

// SQ-2 — لایه‌ی قاعده‌ای فروشگاه. برخلاف محصول: برای آیتم‌های ساخت‌یافته (فیلد) «missing» قطعی مجاز است؛
// برای آیتم‌های متنی فقط ok|unknown.
export const MIN_STORE_KB_FOR_QUALITY = 5;

export interface StoreQualityInput {
  category: string | null;
  requiresShipping: boolean;
  brandIntro: string | null;
  returnPolicy: string | null;
  shippingInfo: string | null;
  ownerNotes: string | null;
  shippingDaysMin: number | null;
  shippingDaysMax: number | null;
  returnPolicyMode: string | null;
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
  logoImageKey: string | null;
  instagramUrl: string | null;
  shippingRulesCount: number;
  hasPaymentMethod: boolean;
  kbCount: number;
}

export type StoreRuleStatus = 'ok' | 'missing' | 'unknown';
export interface StoreRuleReview {
  items: { key: string; label: string; target: string; status: StoreRuleStatus }[];
}

export function ruleStoreReview(store: StoreQualityInput, guide: StoreQualityItem[] = getStoreQualityGuide(store.category, store.requiresShipping)): StoreRuleReview {
  const text = normalizeFa([store.brandIntro, store.returnPolicy, store.shippingInfo, store.ownerNotes].filter(Boolean).join(' '));
  const own = normalizeFa([store.brandIntro, store.returnPolicy, store.shippingInfo].filter(Boolean).join(' '));
  const structured = (ok: boolean): StoreRuleStatus => (ok ? 'ok' : 'missing');
  const items = guide.map((g) => {
    let status: StoreRuleStatus;
    switch (g.key) {
      case 'shipping_days': status = structured(store.shippingDaysMin != null && store.shippingDaysMax != null); break;
      case 'shipping_cost': status = structured(store.shippingRulesCount > 0 || !!store.shippingInfo?.trim()); break;
      case 'payment': status = structured(store.hasPaymentMethod); break;
      case 'working_hours': status = structured(!!(store.workingHoursStart && store.workingHoursEnd)); break;
      case 'logo': status = structured(!!store.logoImageKey); break;
      case 'social': status = structured(!!store.instagramUrl?.trim()); break;
      case 'kb_min': status = structured(store.kbCount >= MIN_STORE_KB_FOR_QUALITY); break;
      case 'brand_intro': status = (store.brandIntro?.trim().length ?? 0) >= 80 ? 'ok' : 'unknown'; break;
      case 'return_policy':
        status = store.returnPolicyMode && store.returnPolicyMode !== 'NONE' ? 'ok' : g.detect.some((d) => own.includes(normalizeFa(d))) ? 'ok' : 'unknown';
        break;
      case 'no_vague': status = VAGUE_PHRASES.some((p) => own.includes(normalizeFa(p))) ? 'unknown' : 'ok'; break;
      default: status = g.detect.some((d) => text.includes(normalizeFa(d))) ? 'ok' : 'unknown';
    }
    return { key: g.key, label: g.label, target: g.target, status };
  });
  return { items };
}
