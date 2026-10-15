import { availableQty, isPurchasable } from './product-visibility';

describe('product-visibility [SP-3]', () => {
  it('tracked product: stock decides', () => {
    expect(isPurchasable({ stock: 2 }, null, 2)).toBe(true);
    expect(isPurchasable({ stock: 2 }, null, 3)).toBe(false);
    expect(isPurchasable({ stock: 0, trackStock: true }, null, 1)).toBe(false);
  });
  it('untracked product is always purchasable, qty is null', () => {
    expect(availableQty({ stock: 0, trackStock: false }, null)).toBeNull();
    expect(isPurchasable({ stock: 0, trackStock: false }, null, 99)).toBe(true);
  });
  it('untracked product: every variant purchasable regardless of variant stock', () => {
    expect(isPurchasable({ stock: 0, trackStock: false }, { stock: 0 }, 5)).toBe(true);
  });
  it('tracked product with variant uses variant stock', () => {
    expect(isPurchasable({ stock: 0 }, { stock: 4 }, 4)).toBe(true);
    expect(isPurchasable({ stock: 100 }, { stock: 0 }, 1)).toBe(false);
  });
  it('non-ACTIVE product is never purchasable', () => {
    expect(isPurchasable({ stock: 9, status: 'DRAFT' }, null, 1)).toBe(false);
    expect(isPurchasable({ stock: 9, status: 'HIDDEN', trackStock: false }, null, 1)).toBe(false);
    expect(isPurchasable({ stock: 9, status: 'ACTIVE' }, null, 1)).toBe(true);
  });
});
