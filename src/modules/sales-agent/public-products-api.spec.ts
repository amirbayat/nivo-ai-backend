import { SalesAgentController } from './sales-agent.controller';
import { ConversationEngineService } from './conversation-engine.service';
import type { UiBlock } from './sales-agent.types';

// docs/PRD-buyer-chat-redesign.md B1 (کنترلر) و B2 (hasVariants)
describe('public-products query parsing [BC-2 B1]', () => {
  function ctl() {
    const listPublicProducts = jest.fn().mockResolvedValue({ items: [] });
    const c = Object.create(SalesAgentController.prototype) as SalesAgentController;
    Object.assign(c, { storeService: { listPublicProducts } });
    return { c, listPublicProducts };
  }

  it('caps ids at 20 and trims blanks', () => {
    const { c, listPublicProducts } = ctl();
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`).join(', ,');
    c.listStoreProducts('shop', undefined, '1', '24', ids, undefined);
    expect(listPublicProducts.mock.calls[0][1].ids).toHaveLength(20);
  });

  it('unknown sort falls back to newest', () => {
    const { c, listPublicProducts } = ctl();
    c.listStoreProducts('shop', undefined, '1', '24', undefined, 'hacked');
    expect(listPublicProducts.mock.calls[0][1].sort).toBe('newest');
    c.listStoreProducts('shop', undefined, '1', '24', undefined, 'price_desc');
    expect(listPublicProducts.mock.calls[1][1].sort).toBe('price_desc');
  });
});

describe('PRODUCT_CARD hasVariants [BC-2 B2]', () => {
  it('is true only for products that have option types', async () => {
    const svc = Object.create(ConversationEngineService.prototype) as ConversationEngineService;
    Object.assign(svc, {
      prisma: { productOptionType: { findMany: async () => [{ productId: 'a' }] } },
    });
    const card = (id: string) => ({
      id, name: id, basePrice: 1, stock: 1, images: [], videos: [],
    });
    const block: UiBlock = { type: 'PRODUCT_CARD', products: [card('a'), card('b')] };
    const out = (await (svc as unknown as { withHasVariants(b: UiBlock): Promise<UiBlock> }).withHasVariants(block)) as Extract<UiBlock, { type: 'PRODUCT_CARD' }>;
    expect(out.products.map((p) => p.hasVariants)).toEqual([true, false]);
  });

  it('flags the caller\'s own block in place, so the reply sent to the client carries it [FX-1 F2]', async () => {
    const svc = Object.create(ConversationEngineService.prototype) as ConversationEngineService;
    Object.assign(svc, {
      prisma: { productOptionType: { findMany: async () => [{ productId: 'a' }] } },
    });
    const block = {
      type: 'PRODUCT_CARD',
      products: [{ id: 'a', name: 'a', basePrice: 1, stock: 1, images: [], videos: [] }],
    } as UiBlock;
    await (svc as unknown as { withHasVariants(b: UiBlock): Promise<UiBlock> }).withHasVariants(block);
    expect((block as Extract<UiBlock, { type: 'PRODUCT_CARD' }>).products[0].hasVariants).toBe(true);
  });

  it('leaves other blocks untouched', async () => {
    const svc = Object.create(ConversationEngineService.prototype) as ConversationEngineService;
    const block: UiBlock = { type: 'NONE' };
    await expect((svc as unknown as { withHasVariants(b: UiBlock): Promise<UiBlock> }).withHasVariants(block)).resolves.toBe(block);
  });
});
