import { composeFastAnswer, eligibleForFastAnswer, formatPrice } from './fast-answers';

const pitch = {
  benefits: ['جنسش لینن خنکه', 'دوختش آزاده و راحته', 'رنگ‌هاش ثابته'],
  valueLines: ['با این کیفیت سال‌ها می‌پوشیش'],
  followUps: ['سایزت چنده؟'],
  openers: ['سلام عزیز 🌸'],
};
const base = { intent: 'ASK_PRICE' as const, productName: 'مانتو لینن', price: { min: 1480000, max: 1480000 }, inStock: true, pitch, seed: 'c1' };

describe('composeFastAnswer', () => {
  it('قیمت زنده در متن و بدون عدد در پیچ', () => {
    const r = composeFastAnswer(base)!;
    expect(r.text).toContain('۱٬۴۸۰٬۰۰۰ تومان');
    expect(r.text).toContain('سایزت چنده؟');
    expect(pitch.benefits.some((b) => r.text.includes(b))).toBe(true);
  });
  it('قطعی بودن و چرخش: خطوط استفاده‌شده تکرار نمی‌شوند', () => {
    const a = composeFastAnswer(base)!;
    expect(composeFastAnswer(base)!.text).toBe(a.text);
    const b = composeFastAnswer({ ...base, usedLines: a.usedLines })!;
    expect(a.usedLines.some((l) => b.text.includes(l) && pitch.benefits.includes(l))).toBe(false);
  });
  it('بازه‌ی قیمت variant', () => {
    expect(formatPrice({ min: 100, max: 200 })).toContain('از');
  });
  it('پیچ ناقص → null؛ نیت غیرمجاز → null', () => {
    expect(composeFastAnswer({ ...base, pitch: { ...pitch, benefits: ['فقط یکی'] } })).toBeNull();
    expect(composeFastAnswer({ ...base, pitch: null })).toBeNull();
    expect(composeFastAnswer({ ...base, intent: 'ASK_SHIPPING' })).toBeNull();
  });
  it('STOCK_CHECK ناموجود: بدون benefit و بدون دعوت به خرید', () => {
    const r = composeFastAnswer({ ...base, intent: 'STOCK_CHECK', inStock: false })!;
    expect(r.text).toContain('ناموجود');
    expect(r.text).not.toContain('سایزت چنده');
  });
});

describe('eligibleForFastAnswer', () => {
  it.each([
    [{ intent: 'ASK_PRICE', negated: false, wordCount: 3, scope: 'p:1' }, true],
    [{ intent: 'ASK_PRICE', negated: true, wordCount: 3, scope: 'p:1' }, false],
    [{ intent: 'ASK_PRICE', negated: false, wordCount: 9, scope: 'p:1' }, false],
    [{ intent: 'ASK_PRICE', negated: false, wordCount: 3, scope: 'store' }, false],
    [{ intent: 'NEGOTIATE_PRICE', negated: false, wordCount: 3, scope: 'p:1' }, false],
  ] as const)('%j → %s', (i, ok) => expect(eligibleForFastAnswer(i as never)).toBe(ok));
});
