import { StoreService } from './store.service';

function build(store: object = {}) {
  const prisma = {
    store: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const productEvents = { log: jest.fn() };
  const svc = Object.create(StoreService.prototype) as StoreService;
  Object.assign(svc, { prisma, productEvents, getOwned: jest.fn().mockResolvedValue({ id: 's1', ...store }) });
  return { svc, prisma, productEvents };
}

describe('launch shared [SP-6]', () => {
  it('first call sets launchSharedAt and logs; second call does not overwrite but still logs', async () => {
    const a = build({ launchSharedAt: null });
    await a.svc.markLaunchShared('u', 's1');
    expect(a.prisma.store.updateMany).toHaveBeenCalledWith({ where: { id: 's1', launchSharedAt: null }, data: { launchSharedAt: expect.any(Date) } });
    const b = build({ launchSharedAt: new Date() });
    await b.svc.markLaunchShared('u', 's1');
    expect(b.prisma.store.updateMany).not.toHaveBeenCalled();
    expect(b.productEvents.log).toHaveBeenCalledWith('shop_link_shared', expect.anything());
  });
});

describe('attention topic dismiss [SP-6]', () => {
  const topic = (t: string) => ({ topic: t, field: 'other', summary: t, occurrences: 2 });
  it('removes the exact topic and remembers it (latest 50)', async () => {
    const dismissed = Array.from({ length: 50 }, (_, i) => `old${i}`);
    const { svc, prisma } = build({ attentionSuggestions: { topics: [topic('a'), topic('b')], dismissedTopics: dismissed } });
    const r = await svc.dismissAttentionTopic('u', 's1', 'a');
    expect(r.topics.map((t) => t.topic)).toEqual(['b']);
    const saved = prisma.store.update.mock.calls[0][0].data.attentionSuggestions;
    expect(saved.dismissedTopics).toHaveLength(50);
    expect(saved.dismissedTopics.at(-1)).toBe('a');
    expect(saved.dismissedTopics).not.toContain('old0');
  });
  it('old array-shaped cache still works', async () => {
    const { svc } = build({ attentionSuggestions: [topic('a')] });
    expect((await svc.dismissAttentionTopic('u', 's1', 'a')).topics).toEqual([]);
  });
  it('getAttentionSuggestions hides dismissed topics from a fresh cache', async () => {
    const { svc } = build({
      attentionSuggestions: { topics: [topic('a'), topic('b')], dismissedTopics: ['a'] },
      attentionSuggestionsComputedAt: new Date(),
    });
    expect((await svc.getAttentionSuggestions('u', 's1')).topics.map((t) => t.topic)).toEqual(['b']);
  });
});

describe('listToday extra fields [SP-6]', () => {
  it('reads last customer messages with ONE query for all waiting conversations', async () => {
    const queryRaw = jest.fn()
      .mockResolvedValueOnce([]) // low stock
      .mockResolvedValueOnce([{ conversationId: 'c1', text: 'x'.repeat(200) }, { conversationId: 'c2', text: 'سلام' }]);
    const prisma = {
      order: { findMany: jest.fn().mockResolvedValue([]) },
      salesConversation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'c1', updatedAt: new Date(1), customer: { phone: '0912', fullName: null } },
          { id: 'c2', updatedAt: new Date(2), customer: { phone: null, fullName: 'نیلوفر' } },
        ]),
      },
      orderRefund: { findMany: jest.fn().mockResolvedValue([]) },
      orderIssue: { findMany: jest.fn().mockResolvedValue([]) },
      productStockAlert: { groupBy: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: queryRaw,
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, { prisma, getOwned: jest.fn().mockResolvedValue({ id: 's1' }) });
    const today = await svc.listToday('u', 's1');
    expect(queryRaw).toHaveBeenCalledTimes(2); // low-stock + one last-message query (no N+1)
    expect(today.conversations[0].lastCustomerMessage).toHaveLength(80);
    expect(today.conversations[1]).toMatchObject({ lastCustomerMessage: 'سلام', waitingSince: new Date(2) });
  });
});
