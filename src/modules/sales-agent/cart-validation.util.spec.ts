import { isValidCartQty, reconcileCart } from './cart-validation.util';
import type { CartItem } from './sales-agent.types';

describe('isValidCartQty [0.2]', () => {
  it.each([-3, -1, 0, 1.5, 0.5, NaN, Infinity, 51, '2', null, undefined])(
    '%p → نامعتبر',
    (q) => expect(isValidCartQty(q)).toBe(false),
  );
  it.each([1, 2, 50])('%p → معتبر', (q) =>
    expect(isValidCartQty(q)).toBe(true),
  );
});

describe('reconcileCart [0.2/0.3]', () => {
  const item = (o: Partial<CartItem> = {}): CartItem => ({
    productId: 'p1',
    name: 'کفش',
    unitPrice: 1000,
    qty: 2,
    ...o,
  });
  const cat = (
    entries: [string, { unitPrice: number; stock: number } | null][],
  ) => new Map(entries);

  it('qty منفی → INVALID_QTY حتی اگر کاتالوگ سالم باشد', () => {
    const r = reconcileCart(
      [item({ qty: -3 })],
      cat([['p1::', { unitPrice: 1000, stock: 9 }]]),
    );
    expect(r.status).toBe('INVALID_QTY');
  });
  it('qty اعشاری → INVALID_QTY', () => {
    expect(
      reconcileCart(
        [item({ qty: 1.5 })],
        cat([['p1::', { unitPrice: 1000, stock: 9 }]]),
      ).status,
    ).toBe('INVALID_QTY');
  });
  it('بدون تغییر → OK', () => {
    expect(
      reconcileCart([item()], cat([['p1::', { unitPrice: 1000, stock: 2 }]]))
        .status,
    ).toBe('OK');
  });
  it('قیمت عوض شده → PRICE_CHANGED با سبد به‌روز', () => {
    const r = reconcileCart(
      [item()],
      cat([['p1::', { unitPrice: 1200, stock: 5 }]]),
    );
    expect(r).toMatchObject({
      status: 'PRICE_CHANGED',
      changes: [{ name: 'کفش', from: 1000, to: 1200 }],
    });
    if (r.status === 'PRICE_CHANGED') expect(r.cart[0].unitPrice).toBe(1200);
  });
  it('موجودی کم → OUT_OF_STOCK (حتی با تغییر قیمت)', () => {
    const r = reconcileCart(
      [item({ qty: 3 })],
      cat([['p1::', { unitPrice: 1200, stock: 2 }]]),
    );
    expect(r).toMatchObject({
      status: 'OUT_OF_STOCK',
      shortages: [{ requested: 3, available: 2 }],
    });
  });
  it('محصول حذف‌شده → OUT_OF_STOCK با موجودی ۰', () => {
    const r = reconcileCart([item()], cat([['p1::', null]]));
    expect(r).toMatchObject({
      status: 'OUT_OF_STOCK',
      shortages: [{ available: 0 }],
    });
  });
  it('واریانت جدا از محصول ساده کلید می‌خورد', () => {
    const r = reconcileCart(
      [item({ variantId: 'v1' })],
      cat([['p1::v1', { unitPrice: 1000, stock: 2 }]]),
    );
    expect(r.status).toBe('OK');
  });
});
