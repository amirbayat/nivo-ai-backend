import { BadRequestException } from '@nestjs/common';
import { StoreService } from './store.service';

type Row = Record<string, unknown>;

function build(before: Row = {}, activeCount = 0, variantCount = 0) {
  const row = {
    id: 'p1', storeId: 's1', name: '', basePrice: 0, stock: 0, status: 'DRAFT', trackStock: true,
    stockSetAt: null, pricingModel: 'FIXED', weightGrams: null, purityKarat: null,
    goldWageType: null, goldWageValue: null, goldProfitPercent: null, ...before,
  };
  const prisma = {
    product: {
      count: jest.fn().mockResolvedValue(activeCount),
      create: jest.fn(async ({ data }: { data: Row }) => ({ id: 'new', ...data })),
      update: jest.fn(async ({ data }: { data: Row }) => ({ ...row, ...data })),
    },
    productVariant: { count: jest.fn().mockResolvedValue(variantCount) },
  };
  const productEvents = { log: jest.fn() };
  const svc = Object.create(StoreService.prototype) as StoreService;
  Object.assign(svc, {
    prisma, productEvents,
    changeLog: { logMany: jest.fn() },
    stockAlerts: { notifyRestocked: jest.fn().mockResolvedValue(undefined) },
    logger: { error: jest.fn() },
    getOwned: jest.fn().mockResolvedValue({ id: 's1' }),
    getOwnedProduct: jest.fn().mockResolvedValue(row),
    assertProductCodeAvailable: jest.fn(),
  });
  return { svc, prisma, productEvents };
}

async function notReady(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).getResponse() as { code: string; missing: string[] };
  }
  throw new Error('expected PRODUCT_NOT_READY');
}

describe('product status transitions [SP-3]', () => {
  it('DRAFT create skips publish validation (empty name, price 0 allowed)', async () => {
    const { svc, prisma, productEvents } = build();
    await svc.createProduct('u', 's1', { name: '', basePrice: 0, status: 'DRAFT' } as never);
    expect(prisma.product.create.mock.calls[0][0].data).toMatchObject({ status: 'DRAFT', stockSetAt: null });
    expect(productEvents.log).toHaveBeenCalledWith('product_draft_created', expect.anything(), { via: 'single' });
  });

  it('ACTIVE create without stock reports exactly the missing fields', async () => {
    const { svc, prisma } = build();
    const r = await notReady(svc.createProduct('u', 's1', { name: 'مانتو', basePrice: 100 } as never));
    expect(r).toMatchObject({ code: 'PRODUCT_NOT_READY', missing: ['stock'] });
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('legacy create (name, price, stock) still works and is ACTIVE', async () => {
    const { svc, prisma } = build();
    const created = await svc.createProduct('u', 's1', { name: 'مانتو', basePrice: 100, stock: 0 } as never);
    expect(prisma.product.create.mock.calls[0][0].data.status).toBe('ACTIVE');
    expect(created.isFirstActiveProduct).toBe(true);
  });

  it('DRAFT → ACTIVE with a missing price → PRODUCT_NOT_READY; with price → published', async () => {
    const a = build({ name: 'مانتو', stockSetAt: new Date() });
    expect((await notReady(a.svc.updateProduct('u', 's1', 'p1', { status: 'ACTIVE' } as never))).missing).toEqual(['price']);
    const b = build({ name: 'مانتو', stockSetAt: new Date() });
    const done = await b.svc.updateProduct('u', 's1', 'p1', { status: 'ACTIVE', basePrice: 890000 } as never);
    expect(done.status).toBe('ACTIVE');
    expect(done.isFirstActiveProduct).toBe(true);
    expect(b.productEvents.log).toHaveBeenCalledWith('product_published', expect.anything(), { via: 'single', first: true, productId: 'p1' });
  });

  it('isFirstActiveProduct is false when the store already has an active product', async () => {
    const { svc } = build({ name: 'مانتو', basePrice: 5, stockSetAt: new Date() }, 2);
    expect((await svc.updateProduct('u', 's1', 'p1', { status: 'ACTIVE' } as never)).isFirstActiveProduct).toBe(false);
  });

  it('stock sent in the same request counts as stock set', async () => {
    const { svc } = build({ name: 'مانتو', basePrice: 5 });
    await expect(svc.updateProduct('u', 's1', 'p1', { status: 'ACTIVE', stock: 3 } as never)).resolves.toBeTruthy();
  });

  it('untracked product or product with variants needs no stock', async () => {
    const a = build({ name: 'مانتو', basePrice: 5, trackStock: false });
    await expect(a.svc.updateProduct('u', 's1', 'p1', { status: 'ACTIVE' } as never)).resolves.toBeTruthy();
    const b = build({ name: 'مانتو', basePrice: 5 }, 0, 4);
    await expect(b.svc.updateProduct('u', 's1', 'p1', { status: 'ACTIVE' } as never)).resolves.toBeTruthy();
  });

  it('ACTIVE or HIDDEN cannot go back to DRAFT', async () => {
    const { svc } = build({ status: 'ACTIVE', name: 'x y', basePrice: 5 });
    await expect(svc.updateProduct('u', 's1', 'p1', { status: 'DRAFT' } as never)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writing stock sets stockSetAt', async () => {
    const { svc, prisma } = build({ status: 'ACTIVE', name: 'x y', basePrice: 5 });
    await svc.updateProduct('u', 's1', 'p1', { stock: 4 } as never);
    expect(prisma.product.update.mock.calls[0][0].data.stockSetAt).toBeInstanceOf(Date);
  });
});
