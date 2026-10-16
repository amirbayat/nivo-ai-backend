import { BUSINESS_CATEGORIES } from './business-categories';
import { getProductQualityGuide, hasDedicatedGuide } from './product-quality-guides';
import { ruleReview } from './product-quality-rules';

const long = 'این مانتو از لینن خنک دوخته شده و مناسب تابستان است. فیت آزاد دارد و شستشو با ماشین ۳۰ درجه مشکلی ندارد. عرض سینه سایز L برابر ۵۴ سانت است و قد ۷۲ می‌باشد. رنگ‌ها: مشکی و سرمه‌ای.';
const status = (r: ReturnType<typeof ruleReview>, key: string) => r.items.find((i) => i.key === key)?.status;

describe('product quality guides', () => {
  it('هر ۲۱ دسته راهنمای اختصاصی دارد', () => {
    for (const c of BUSINESS_CATEGORIES) expect(hasDedicatedGuide(c)).toBe(true);
  });
  it('هر آیتم label/why/askPrompt دارد و کلیدها در هر دسته یکتا هستند', () => {
    for (const c of BUSINESS_CATEGORIES) {
      const g = getProductQualityGuide(c);
      expect(new Set(g.map((i) => i.key)).size).toBe(g.length);
      for (const i of g) expect(i.label && i.why && i.askPrompt).toBeTruthy();
    }
  });
});

describe('ruleReview (PQ-1)', () => {
  it('پوشاک: متن کامل → آیتم‌های جنس/سایز/فیت/شستشو ok', () => {
    const r = ruleReview({ name: 'مانتو لینن تابستانه', description: long, imageCount: 4, category: 'پوشاک', optionTypes: [{ name: 'رنگ', values: ['مشکی'] }] });
    for (const k of ['material', 'size_real', 'fit', 'wash', 'colors', 'desc_length', 'photos', 'no_vague']) expect(status(r, k)).toBe('ok');
  });
  it('پوشاک: متن خالی → هیچ‌چیز missing نمی‌شود، فقط unknown', () => {
    const r = ruleReview({ name: 'مانتو', description: null, imageCount: 0, category: 'پوشاک' });
    expect(r.items.every((i) => i.status === 'unknown' || i.status === 'ok')).toBe(true);
    expect(status(r, 'desc_length')).toBe('unknown');
    expect(status(r, 'photos')).toBe('unknown');
  });
  it('ادعای تهی no_vague را ok نمی‌کند', () => {
    const r = ruleReview({ name: 'کفش چرم', description: 'بهترین کیفیت و عالی', imageCount: 1, category: 'کیف و کفش' });
    expect(status(r, 'no_vague')).toBe('unknown');
  });
  it('specs و optionTypes هم حساب می‌شوند', () => {
    const r = ruleReview({ name: 'کرم مرطوب‌کننده', description: 'x', specs: { 'حجم': '۵۰ میل', 'نوع پوست': 'خشک' }, imageCount: 3, category: 'آرایشی و بهداشتی' });
    expect(status(r, 'volume')).toBe('ok');
    expect(status(r, 'skin')).toBe('ok');
  });
  it('دیجیتال و کتاب و خدمات', () => {
    expect(status(ruleReview({ name: 'کابل شارژ تایپ سی', description: 'سازگار با سامسونگ، ۶۰ وات، طول ۲ متر، گارانتی ۱۸ ماهه', imageCount: 3, category: 'دیجیتال و لوازم جانبی' }), 'compat')).toBe('ok');
    expect(status(ruleReview({ name: 'رمان سووشون', description: 'نویسنده: سیمین دانشور، نشر خوارزمی، چاپ ۴۰، ۲۴۰ صفحه رقعی', imageCount: 1, category: 'کتاب و لوازم‌التحریر' }), 'author')).toBe('ok');
    expect(status(ruleReview({ name: 'جلسه مشاوره', description: 'جلسه ۴۵ دقیقه‌ای آنلاین؛ لغو تا ۲۴ ساعت قبل', imageCount: 0, category: 'مشاوره' }), 'cancel')).toBe('ok');
  });
});
