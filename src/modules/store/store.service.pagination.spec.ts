import { StoreService } from './store.service';

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `o${i}`,
    items: [],
    createdAt: new Date(),
  }));
}

function build(orderRows: unknown[], productRows: unknown[] = []) {
  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue(orderRows) },
    contentQualityReview: { findMany: jest.fn().mockResolvedValue([]) },
    store: { findUnique: jest.fn().mockResolvedValue({ category: 'پوشاک' }) },
    product: {
      findMany: jest.fn().mockResolvedValue(productRows),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const svc = Object.create(StoreService.prototype) as StoreService;
  Object.assign(svc, {
    prisma,
    getOwned: jest.fn(async () => ({ id: 'store-1' })),
    relatedKbEntryCounts: jest.fn(async () => new Map()),
    stockAlerts: { openCountsByProduct: jest.fn(async () => new Map()) },
  });
  return { svc, prisma };
}

describe('listOrdersPage [R3.2]', () => {
  it('limit+1 می‌خواند، limit تا برمی‌گرداند و nextCursor آخرین آیتم صفحه است', async () => {
    const { svc, prisma } = build(rows(51));
    const page = await svc.listOrdersPage('s', 'store-1', undefined, undefined, {
      limit: 50,
    });
    expect(prisma.order.findMany.mock.calls[0][0]).toMatchObject({
      take: 51,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(prisma.order.findMany.mock.calls[0][0].cursor).toBeUndefined();
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBe('o49');
  });

  it('صفحه‌ی آخر ← nextCursor null؛ cursor ورودی با skip:1 اعمال می‌شود', async () => {
    const { svc, prisma } = build(rows(7));
    const page = await svc.listOrdersPage('s', 'store-1', undefined, undefined, {
      cursor: 'o49',
      limit: 50,
    });
    expect(prisma.order.findMany.mock.calls[0][0]).toMatchObject({
      cursor: { id: 'o49' },
      skip: 1,
    });
    expect(page.items).toHaveLength(7);
    expect(page.nextCursor).toBeNull();
  });
});

describe('listProductsPage [R3.2]', () => {
  it('limit+1 می‌خواند و nextCursor می‌دهد', async () => {
    const productRows = Array.from({ length: 3 }, (_, i) => ({
      id: `p${i}`,
      images: [],
      description: '',
      optionTypes: [],
      variants: [],
    }));
    const { svc, prisma } = build([], productRows);
    const page = await svc.listProductsPage('s', 'store-1', { limit: 2 });
    expect(prisma.product.findMany.mock.calls[0][0]).toMatchObject({
      take: 3,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe('p1');
  });
});
