import { shouldForceFinalAnswer } from './loop-diet';

const st = (name: string, input: unknown = {}) => ({ toolCalls: [{ toolName: name, input }] });

describe('loop diet [ACE-6]', () => {
  it('step ۱ تا ۳ آزاد، از step ۴ اجباری', () => {
    expect(shouldForceFinalAnswer(0, [])).toBe(false);
    expect(shouldForceFinalAnswer(2, [st('search_products'), st('get_product_details')])).toBe(false);
    expect(shouldForceFinalAnswer(3, [st('a'), st('b'), st('c')])).toBe(true);
  });
  it('ابزار تکراری با ورودی یکسان → قطع', () => {
    expect(shouldForceFinalAnswer(2, [st('search_products', { q: 'x' }), st('search_products', { q: 'x' })])).toBe(true);
    expect(shouldForceFinalAnswer(2, [st('search_products', { q: 'x' }), st('search_products', { q: 'y' })])).toBe(false);
  });
  it('ورودی متفاوت یا stepهای بدون ابزار → قطع نمی‌کند', () => {
    expect(shouldForceFinalAnswer(2, [{}, {}])).toBe(false);
  });
});
