import { getRecentConversationEvents } from './conversation-events.util';

// PRD-nivo-sales-unified.md تسک 0.6 — مکالمه‌ی ۸۰ پیامی: آخرین پیام دیده شود
const all = Array.from({ length: 80 }, (_, i) => ({
  id: `e${i + 1}`,
  conversationId: 'c1',
  createdAt: new Date(2026, 0, 1, 0, 0, i),
}));
const fakePrisma = {
  conversationEvent: {
    findMany: jest.fn(
      async (a: {
        where: { createdAt?: { lt: Date } };
        orderBy: { createdAt: 'asc' | 'desc' };
        take: number;
      }) => {
        let rows = [...all];
        if (a.where.createdAt)
          rows = rows.filter((r) => r.createdAt < a.where.createdAt!.lt);
        rows.sort((x, y) =>
          a.orderBy.createdAt === 'desc'
            ? y.createdAt.getTime() - x.createdAt.getTime()
            : x.createdAt.getTime() - y.createdAt.getTime(),
        );
        return rows.slice(0, a.take);
      },
    ),
  },
};

describe('getRecentConversationEvents [0.6]', () => {
  it('جدیدترین ۵۰ رویداد به ترتیب زمانی؛ آخرین پیام موجود است', async () => {
    const { events, hasMoreEvents } = await getRecentConversationEvents(
      fakePrisma as never,
      'c1',
    );
    expect(events).toHaveLength(50);
    expect(events[0].id).toBe('e31');
    expect(events[49].id).toBe('e80');
    expect(hasMoreEvents).toBe(true);
  });
  it('before: صفحه‌ی قدیمی‌تر، بدون هم‌پوشانی، و hasMore=false در انتها', async () => {
    const first = await getRecentConversationEvents(fakePrisma as never, 'c1');
    const { events, hasMoreEvents } = await getRecentConversationEvents(
      fakePrisma as never,
      'c1',
      first.events[0].createdAt.toISOString(),
    );
    expect(events.map((e) => e.id)).toEqual(
      Array.from({ length: 30 }, (_, i) => `e${i + 1}`),
    );
    expect(hasMoreEvents).toBe(false);
  });
  it('before نامعتبر نادیده گرفته می‌شود', async () => {
    const { events } = await getRecentConversationEvents(
      fakePrisma as never,
      'c1',
      'garbage',
    );
    expect(events[49].id).toBe('e80');
  });
});
