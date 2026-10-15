import { formatShippingDays, isValidShippingDays } from './shipping-days.util';

describe('formatShippingDays [R3.3]', () => {
  it('بازه ← «معمولاً ۲–۴ روز کاری ارسال می‌شه»', () => {
    expect(formatShippingDays(2, 4)).toBe('معمولاً ۲–۴ روز کاری ارسال می‌شه');
  });
  it('min == max ← یک عدد', () => {
    expect(formatShippingDays(3, 3)).toBe('معمولاً ۳ روز کاری ارسال می‌شه');
  });
  it('فقط یکی پر باشد یا هیچ ← null (چیزی ساخته نمی‌شود)', () => {
    expect(formatShippingDays(null, 4)).toBeNull();
    expect(formatShippingDays(2, null)).toBeNull();
    expect(formatShippingDays(null, null)).toBeNull();
    expect(formatShippingDays(undefined, undefined)).toBeNull();
  });
});

describe('isValidShippingDays [R3.3]', () => {
  it('هر دو خالی یا هر دو پر با 1 ≤ min ≤ max ≤ 60', () => {
    expect(isValidShippingDays(null, null)).toBe(true);
    expect(isValidShippingDays(1, 60)).toBe(true);
    expect(isValidShippingDays(3, 3)).toBe(true);
  });
  it('نامعتبر', () => {
    expect(isValidShippingDays(5, 2)).toBe(false);
    expect(isValidShippingDays(0, 2)).toBe(false);
    expect(isValidShippingDays(1, 61)).toBe(false);
    expect(isValidShippingDays(2, null)).toBe(false);
    expect(isValidShippingDays(null, 2)).toBe(false);
  });
});
