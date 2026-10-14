import {
  ORDER_CODE_ALPHABET,
  displayOrderCode,
  formatOrderCode,
  generateOrderCode,
  normalizeOrderCodeInput,
  normalizeOrderCodePartialInput,
} from './order-code.util';

describe('order code [3.4]', () => {
  it('الفبا ۳۱ نویسه و بدون مبهم‌ها', () => {
    expect(ORDER_CODE_ALPHABET).toHaveLength(31);
    for (const bad of '01OIL') expect(ORDER_CODE_ALPHABET).not.toContain(bad);
  });

  it('قالب NV + ۶ نویسه؛ تصادفی', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const c = generateOrderCode();
      expect(c).toMatch(/^NV[2-9A-HJKMNP-Z]{6}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(495);
  });

  it('نمایش با خط تیره و fallback به ۸ نویسه‌ی id', () => {
    expect(formatOrderCode('NVK7M2QX')).toBe('NV-K7M2QX');
    expect(formatOrderCode(null)).toBeNull();
    expect(displayOrderCode({ id: 'abcdef12-3456', orderCode: null })).toBe(
      'abcdef12',
    );
    expect(displayOrderCode({ id: 'x', orderCode: 'NVK7M2QX' })).toBe(
      'NV-K7M2QX',
    );
  });

  it('نرمال‌سازی ورودی جست‌وجو', () => {
    expect(normalizeOrderCodeInput('nv-k7m2qx')).toBe('NVK7M2QX');
    expect(normalizeOrderCodeInput(' NV K7M2QX ')).toBe('NVK7M2QX');
    expect(normalizeOrderCodeInput('k7m2qx')).toBe('NVK7M2QX');
    // ارقام فارسی/عربی
    expect(normalizeOrderCodeInput('NV-۷K۴M۲Q')).toBe('NV7K4M2Q');
    expect(normalizeOrderCodeInput('NV-7K4M2Q')).toBe('NV7K4M2Q');
  });

  it('ورودی نامعتبر → null', () => {
    expect(normalizeOrderCodeInput('')).toBeNull();
    expect(normalizeOrderCodeInput('NV-12')).toBeNull();
    expect(normalizeOrderCodeInput('NV-K7M2QO')).toBeNull(); // O مجاز نیست
    expect(normalizeOrderCodeInput('NV-K7M2QXX')).toBeNull();
  });

  it('جست‌وجوی جزئی: بخشی از کد با/بدون پیشوند', () => {
    expect(normalizeOrderCodePartialInput('k7m')).toBe('K7M');
    expect(normalizeOrderCodePartialInput('nv-k7')).toBe('K7');
    expect(normalizeOrderCodePartialInput('K7M2QX')).toBe('K7M2QX');
  });

  it('جست‌وجوی جزئی: خیلی کوتاه/نامعتبر/نام و شماره → null', () => {
    expect(normalizeOrderCodePartialInput('k')).toBeNull();
    expect(normalizeOrderCodePartialInput('علی')).toBeNull();
    expect(normalizeOrderCodePartialInput('0912')).toBeNull(); // 0 و 1 در الفبا نیستند
    expect(normalizeOrderCodePartialInput('K7M2QXX')).toBeNull();
  });
});
