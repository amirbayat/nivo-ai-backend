import { safeEqual } from './safe-equal.util';

describe('safeEqual', () => {
  it('مقدار برابر → true', () => expect(safeEqual('abc', 'abc')).toBe(true));
  it('مقدار نابرابر → false', () => expect(safeEqual('abc', 'abd')).toBe(false));
  it('طول متفاوت → false بدون throw', () =>
    expect(safeEqual('abc', 'abcd')).toBe(false));
  it('undefined/null → false (حتی اگر هر دو خالی)', () => {
    expect(safeEqual(undefined, undefined)).toBe(false);
    expect(safeEqual(undefined, 'x')).toBe(false);
    expect(safeEqual('x', null)).toBe(false);
  });
  it('رشته‌ی خالی برابر خالی → true', () => expect(safeEqual('', '')).toBe(true));
});
