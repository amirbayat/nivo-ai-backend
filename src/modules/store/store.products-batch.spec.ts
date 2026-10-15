import { NotFoundException } from '@nestjs/common';
import { StoreService } from './store.service';

const draft = (id: string, over: object = {}) => ({
  id, storeId: 's1', name: 'مانتو', basePrice: 100, pricingModel: 'FIXED', trackStock: true,
  stockSetAt: new Date(), status: 'DRAFT', _count: { variants: 0 }, ...over,
});

function build(rows: object[], active = 0) {
  const prisma = {
    product: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(active),
      update: jest.fn().mockResolvedValue({}),
      groupBy: jest.fn().mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 4 } }, { status: 'DRAFT', _count: { _all: 2 } }]),
    },
  };
  const productEvents = { log: jest.fn() };
  const svc = Object.create(StoreService.prototype) as StoreService;
  Object.assign(svc, { prisma, productEvents, getOwned: jest.fn().mockResolvedValue({ id: 's1' }) });
  return { svc, prisma, productEvents };
}

describe('publishProducts [SP-5]', () => {
  it('splits ready and not-ready ids, ids of another store are reported not_found', async () => {
    const { svc, prisma, productEvents } = build([
      draft('a'), draft('b', { basePrice: 0 }), draft('c', { name: '', stockSetAt: null }),
    ]);
    const r = await svc.publishProducts('u', 's1', ['a', 'b', 'c', 'foreign']);
    expect(r.published).toEqual(['a']);
    expect(r.failed).toEqual([
      { id: 'b', missing: ['price'] },
      { id: 'c', missing: ['name', 'stock'] },
      { id: 'foreign', missing: ['not_found'] },
    ]);
    expect(prisma.product.update).toHaveBeenCalledTimes(1);
    expect(productEvents.log).toHaveBeenCalledWith('product_published', expect.anything(), { via: 'batch', first: true });
  });
  it('only the first publish of an empty store is flagged first', async () => {
    const { svc, productEvents } = build([draft('a'), draft('b')]);
    await svc.publishProducts('u', 's1', ['a', 'b']);
    expect(productEvents.log.mock.calls.map((c) => c[2].first)).toEqual([true, false]);
  });
});

describe('listProductsPage counts [SP-5]', () => {
  it('returns counts per status and filters by the requested one', async () => {
    const { svc, prisma } = build([]);
    (svc as unknown as { findProductsWithCompleteness: jest.Mock }).findProductsWithCompleteness = jest.fn().mockResolvedValue([]);
    const r = await svc.listProductsPage('u', 's1', { limit: 10 }, 'DRAFT');
    expect(r.counts).toEqual({ ACTIVE: 4, DRAFT: 2, HIDDEN: 0 });
    expect((svc as unknown as { findProductsWithCompleteness: jest.Mock }).findProductsWithCompleteness).toHaveBeenCalledWith('s1', { limit: 10 }, ['DRAFT']);
    expect(prisma.product.groupBy).toHaveBeenCalled();
  });
});

describe('duplicateProduct [SP-5]', () => {
  function buildDup(foreign = false) {
    const src = {
      id: 'p1', storeId: 's1', name: 'مانتو', basePrice: 900, pricingModel: 'FIXED', weightGrams: null, purityKarat: null,
      goldWageType: null, goldWageValue: null, goldProfitPercent: null, description: 'd', specs: null, trackStock: false,
      persuasionTechniquesEnabled: true, hasFulfillmentDelay: false, code: 'C1', telegramShortCode: 'x', images: ['k'], stock: 7,
      optionTypes: [{ name: 'سایز', values: [{ value: 'M' }] }], variants: [{ optionValues: { سایز: 'M' }, stock: 5, priceOverride: 950, weightGrams: null, purityKarat: null, sku: 'SKU' }],
    };
    const created: Record<string, unknown>[] = [];
    const tx = {
      product: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return { id: 'new', ...data }; }) },
      productOptionType: { create: jest.fn() },
      productVariant: { create: jest.fn() },
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma: { product: { findUnique: async () => src }, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
      productEvents: { log: jest.fn() },
      getOwnedProduct: foreign ? jest.fn().mockRejectedValue(new NotFoundException()) : jest.fn().mockResolvedValue(src),
    });
    return { svc, tx, created };
  }
  it('creates a DRAFT with copied fields and none of the excluded ones', async () => {
    const { svc, tx, created } = buildDup();
    await svc.duplicateProduct('u', 's1', 'p1');
    const d = created[0];
    expect(d).toMatchObject({ status: 'DRAFT', name: 'مانتو (کپی)', basePrice: 900, trackStock: false, stock: 0, stockSetAt: null });
    for (const k of ['code', 'telegramShortCode', 'images', 'videos']) expect(d).not.toHaveProperty(k);
    expect(tx.productVariant.create.mock.calls[0][0].data).toMatchObject({ stock: 0, priceOverride: 950 });
    expect(tx.productVariant.create.mock.calls[0][0].data).not.toHaveProperty('sku');
  });
  it("another store's product → 404", async () => {
    await expect(buildDup(true).svc.duplicateProduct('u', 's1', 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
