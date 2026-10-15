import { StockAlertService } from './stock-alert.service';
import { adjustOrderStock } from './order-stock.util';
import { StoreService } from '../store/store.service';

describe('«همیشه موجود» (trackStock=false) [SP-3]', () => {
  const items = [{ productId: 'p1', qty: 3, name: 'x' }];

  function db(trackStock: boolean) {
    return {
      product: {
        findUnique: jest.fn().mockResolvedValue({ trackStock }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue({ stock: 0 }),
      },
      productVariant: { updateMany: jest.fn(), findFirst: jest.fn() },
    };
  }

  it('order approval does not decrement stock and reports no shortage', async () => {
    const d = db(false);
    await expect(adjustOrderStock(d as never, items, 'DEDUCT')).resolves.toEqual([]);
    expect(d.product.updateMany).not.toHaveBeenCalled();
  });

  it('cancelling an approved order restores nothing', async () => {
    const d = db(false);
    await adjustOrderStock(d as never, items, 'RESTORE');
    expect(d.product.updateMany).not.toHaveBeenCalled();
  });

  it('tracked product with stock 0 is still rejected as before (shortage reported)', async () => {
    const d = db(true);
    const shortages = await adjustOrderStock(d as never, items, 'DEDUCT');
    expect(shortages).toHaveLength(1);
  });

  it('untracked variants are skipped too (they carry the product trackStock)', async () => {
    const d = db(false);
    await adjustOrderStock(d as never, [{ productId: 'p1', variantId: 'v1', qty: 2 }], 'DEDUCT');
    expect(d.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('back-in-stock subscription answers in_stock for untracked products', async () => {
    const svc = Object.create(StockAlertService.prototype) as StockAlertService;
    Object.assign(svc, {
      prisma: { product: { findFirst: async () => ({ id: 'p1', stock: 0, trackStock: false }) } },
    });
    await expect(
      svc.subscribe({ storeId: 's', productId: 'p1', customerId: 'c', conversationId: 'cv' }),
    ).resolves.toEqual({ status: 'in_stock' });
  });

  it('restore lines skip untracked products', async () => {
    const svc = Object.create(StockAlertService.prototype) as StockAlertService;
    const tx = { product: { findUnique: async () => ({ stock: 0, trackStock: false }) } };
    await expect(svc.collectRestoreLines(tx as never, [{ productId: 'p1', qty: 2 }])).resolves.toEqual([]);
  });
});

describe('buyer visibility [SP-3]', () => {
  it('public product list only asks for ACTIVE products', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma: {
        store: { findUnique: async () => ({ id: 's1', status: 'ACTIVE', requiresShipping: false }) },
        product: { findMany, count },
        productComment: { groupBy: async () => [] },
      },
    });
    await svc.listPublicProducts('shop', { page: 1, pageSize: 10 }).catch(() => undefined);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ storeId: 's1', status: 'ACTIVE' });
    expect(count.mock.calls[0][0].where).toMatchObject({ status: 'ACTIVE' });
  });
});
