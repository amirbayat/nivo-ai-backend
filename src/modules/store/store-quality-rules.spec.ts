import { BUSINESS_CATEGORIES } from './business-categories';
import { STORE_CATEGORY_ITEMS, getStoreQualityGuide } from './store-quality-guides';
import { ruleStoreReview, type StoreQualityInput } from './store-quality-rules';

const base: StoreQualityInput = {
  category: 'آرایشی و بهداشتی', requiresShipping: true, brandIntro: null, returnPolicy: null, shippingInfo: null, ownerNotes: null,
  shippingDaysMin: null, shippingDaysMax: null, returnPolicyMode: 'NONE', workingHoursStart: null, workingHoursEnd: null,
  logoImageKey: null, instagramUrl: null, shippingRulesCount: 0, hasPaymentMethod: false, kbCount: 0,
};
const st = (r: ReturnType<typeof ruleStoreReview>, key: string) => r.items.find((i) => i.key === key)?.status;

describe('store quality guides/rules (SQ-1/SQ-2)', () => {
  it('هر ۲۱ دسته کلید دارد', () => {
    for (const c of BUSINESS_CATEGORIES) expect(c in STORE_CATEGORY_ITEMS).toBe(true);
  });
  it('فروشگاه بدون ارسال: آیتم‌های ارسال حذف، نحوه‌ی ارائه جایگزین', () => {
    const keys = getStoreQualityGuide('مشاوره', false).map((i) => i.key);
    expect(keys).not.toContain('shipping_days');
    expect(keys).toContain('delivery_mode');
    expect(getStoreQualityGuide('پوشاک', true).map((i) => i.key)).not.toContain('delivery_mode');
  });
  it('فیلدهای ساخت‌یافته: missing قطعی', () => {
    const r = ruleStoreReview(base);
    for (const k of ['shipping_days', 'shipping_cost', 'payment', 'working_hours', 'logo', 'social', 'kb_min']) expect(st(r, k)).toBe('missing');
  });
  it('متنی‌ها هرگز missing نمی‌شوند', () => {
    const r = ruleStoreReview(base);
    for (const k of ['brand_intro', 'return_policy', 'authenticity', 'opened_return']) expect(st(r, k)).not.toBe('missing');
  });
  it('پر بودن فیلدها → ok', () => {
    const r = ruleStoreReview({
      ...base, shippingDaysMin: 2, shippingDaysMax: 4, shippingRulesCount: 1, hasPaymentMethod: true, workingHoursStart: '09:00', workingHoursEnd: '21:00',
      logoImageKey: 'k', instagramUrl: 'x', kbCount: 5, returnPolicyMode: 'FULL', brandIntro: 'تمام محصولات ما اصل و شرکتی هستند و با کد ردیابی ارسال می‌شوند.',
      returnPolicy: 'محصول باز شده مرجوع نمی‌شود، پلمپ باشد.',
    });
    for (const k of ['shipping_days', 'shipping_cost', 'payment', 'working_hours', 'logo', 'social', 'kb_min', 'return_policy', 'authenticity', 'opened_return']) expect(st(r, k)).toBe('ok');
  });
  it('ادعای تهی no_vague را ok نمی‌کند', () => {
    expect(st(ruleStoreReview({ ...base, brandIntro: 'بهترین کیفیت' }), 'no_vague')).toBe('unknown');
  });
});
