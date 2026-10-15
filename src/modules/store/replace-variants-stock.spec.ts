import { StoreService } from './store.service';

describe('replaceProductVariants stock [F13]', () => {
  it('keeps the stored stock when an existing variant omits it, and starts a new one at 0', async () => {
    const updates: Record<string, unknown>[] = [];
    const creates: Record<string, unknown>[] = [];
    const tx = {
      productVariant: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'v1', optionValues: { size: 'M' }, stock: 7 },
        ]),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return {};
        }),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          creates.push(data);
          return {};
        }),
        deleteMany: jest.fn(),
      },
      productOptionType: {
        deleteMany: jest.fn(),
        create: jest.fn(),
      },
    };
    const notifyRestocked = jest.fn().mockResolvedValue(undefined);
    const service = Object.create(StoreService.prototype) as {
      replaceProductVariants: (...args: unknown[]) => Promise<unknown>;
    };
    Object.assign(service, {
      prisma: {
        $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
        product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1' }) },
      },
      getOwnedProduct: jest.fn().mockResolvedValue({ id: 'p1' }),
      stockAlerts: { notifyRestocked },
      logger: { error: jest.fn() },
    });

    await service.replaceProductVariants('seller', 'store', 'p1', {
      optionTypes: [{ name: 'size', values: ['M', 'L'] }],
      variants: [
        { optionValues: { size: 'M' } },
        { optionValues: { size: 'L' } },
      ],
    });

    expect(updates[0]).not.toHaveProperty('stock');
    expect(creates[0]).toMatchObject({ stock: 0 });
    expect(notifyRestocked).toHaveBeenCalledWith([]);
  });
});
