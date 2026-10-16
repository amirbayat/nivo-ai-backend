import { StoreService } from './store.service';

// docs/PRD-buyer-chat-redesign.md B1 — ids + sort روی GET stores/:slug/public-products
describe('listPublicProducts ids/sort [BC-2 B1]', () => {
  function build(opts: { orders?: { items: unknown }[]; candidates?: { id: string; createdAt: Date }[] } = {}) {
    const findMany = jest.fn().mockImplementation(async (args: { select?: { createdAt?: boolean }; where: { id?: { in: string[] } } }) => {
      if (args.select?.createdAt) return opts.candidates ?? [];
      const ids = args.where.id?.in ?? [];
      return ids.map((id) => ({
        id,
        name: id,
        basePrice: 100,
        stock: 1,
        trackStock: true,
        images: [],
        videos: [],
        description: null,
        pricingModel: 'FIXED',
        weightGrams: null,
        purityKarat: null,
        goldWageType: null,
        goldWageValue: null,
        goldProfitPercent: null,
        optionTypes: [],
        variants: [],
      }));
    });
    const orderFindMany = jest.fn().mockResolvedValue(opts.orders ?? []);
    const orderCount = jest.fn().mockResolvedValue(5);
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma: {
        store: { findUnique: async () => ({ id: 's1', status: 'ACTIVE', requiresShipping: false }) },
        product: { findMany, count: async () => 0 },
        productComment: { groupBy: async () => [] },
        order: { findMany: orderFindMany, count: orderCount },
      },
    });
    return { svc, findMany };
  }

  it('ids filter is applied together with the buyer-visibility filter', async () => {
    const { svc, findMany } = build();
    await svc.listPublicProducts('shop', { page: 1, pageSize: 20, ids: ['a', 'b'] });
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      storeId: 's1',
      status: 'ACTIVE',
      id: { in: ['a', 'b'] },
    });
  });

  it('price_asc / price_desc order by basePrice; default is newest', async () => {
    const asc = build();
    await asc.svc.listPublicProducts('shop', { page: 1, pageSize: 10, sort: 'price_asc' });
    expect(asc.findMany.mock.calls[0][0].orderBy[0]).toEqual({ basePrice: 'asc' });
    const desc = build();
    await desc.svc.listPublicProducts('shop', { page: 1, pageSize: 10, sort: 'price_desc' });
    expect(desc.findMany.mock.calls[0][0].orderBy[0]).toEqual({ basePrice: 'desc' });
    const def = build();
    await def.svc.listPublicProducts('shop', { page: 1, pageSize: 10 });
    expect(def.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }]);
  });

  it('popular sorts by sold quantity, ties by newest, and paginates ids', async () => {
    const t = (n: number) => new Date(2026, 0, n);
    const { svc } = build({
      candidates: [
        { id: 'old', createdAt: t(1) },
        { id: 'mid', createdAt: t(2) },
        { id: 'new', createdAt: t(3) },
        { id: 'best', createdAt: t(0) },
      ],
      orders: [
        { items: [{ productId: 'best', qty: 3 }] },
        { items: [{ productId: 'mid', qty: 1 }, { productId: 'old', qty: 1 }] },
      ],
    });
    const page = await svc.listPublicProducts('shop', { page: 1, pageSize: 3, sort: 'popular' });
    expect(page.items.map((i) => i.id)).toEqual(['best', 'mid', 'old']);
    expect(page.popularSortAvailable).toBe(true);
    expect(page.requiresShipping).toBe(false);
    const page2 = await svc.listPublicProducts('shop', { page: 2, pageSize: 3, sort: 'popular' });
    expect(page2.items.map((i) => i.id)).toEqual(['new']);
  });
});
