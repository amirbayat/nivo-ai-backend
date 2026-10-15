import { ProductEventService } from './product-event.service';

describe('ProductEventService', () => {
  const make = (create: jest.Mock, count: jest.Mock = jest.fn()) =>
    new ProductEventService({ productEvent: { create, count } } as never);

  it('writes the event with ctx and props', async () => {
    const create = jest.fn().mockResolvedValue({});
    make(create).log('store_created', { storeId: 's1', userId: 'u1' }, { category: 'x' });
    await Promise.resolve();
    expect(create).toHaveBeenCalledWith({
      data: { name: 'store_created', storeId: 's1', userId: 'u1', conversationId: null, props: { category: 'x' } },
    });
  });

  it('swallows an async database error', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    expect(() => make(create).log('shop_link_shared', { storeId: 's1' })).not.toThrow();
    await new Promise((r) => setImmediate(r));
  });

  it('swallows a synchronous throw', () => {
    const create = jest.fn(() => {
      throw new Error('boom');
    });
    expect(() => make(create).log('shop_link_shared')).not.toThrow();
  });

  it('countSince filters by name, store and date', async () => {
    const count = jest.fn().mockResolvedValue(7);
    const since = new Date('2026-10-15T00:00:00Z');
    await expect(make(jest.fn(), count).countSince('product_ai_draft', 's1', since)).resolves.toBe(7);
    expect(count).toHaveBeenCalledWith({
      where: { name: 'product_ai_draft', storeId: 's1', createdAt: { gte: since } },
    });
  });
});
