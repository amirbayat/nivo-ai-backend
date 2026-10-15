import { parsePageQuery } from './page-query.util';

describe('parsePageQuery [R3.2]', () => {
  it('پیش‌فرض ۵۰ و بدون cursor', () => {
    expect(parsePageQuery()).toEqual({ cursor: undefined, limit: 50 });
    expect(parsePageQuery('', '')).toEqual({ cursor: undefined, limit: 50 });
  });
  it('limit نامعتبر ← ۵۰؛ بزرگ ← سقف ۱۰۰؛ ارقام فارسی', () => {
    expect(parsePageQuery(undefined, 'abc').limit).toBe(50);
    expect(parsePageQuery(undefined, '0').limit).toBe(50);
    expect(parsePageQuery(undefined, '-5').limit).toBe(50);
    expect(parsePageQuery(undefined, '9999').limit).toBe(100);
    expect(parsePageQuery(undefined, '۲۰').limit).toBe(20);
  });
  it('cursor را trim و کوتاه می‌کند', () => {
    expect(parsePageQuery('  abc ', '10').cursor).toBe('abc');
    expect(parsePageQuery('x'.repeat(200)).cursor).toHaveLength(64);
  });
});
