import { ConversationEngineService } from './conversation-engine.service';

// SP-3 — محصول DRAFT/HIDDEN هرگز به AI/خریدار نمی‌رسد: همه‌ی کوئری‌های جست‌وجوی کاتالوگ ACTIVE می‌خواهند
describe('AI catalog search only sees ACTIVE products [SP-3]', () => {
  it('searchProducts filters every query by status ACTIVE', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const eng = Object.create(ConversationEngineService.prototype) as unknown as {
      searchProducts: (storeId: string, q?: string | null) => Promise<unknown[]>;
    };
    Object.assign(eng, {
      prisma: { product: { findFirst, findMany, count } },
      resolveProductPrices: jest.fn(),
      logger: { warn: jest.fn() },
    });
    await eng.searchProducts('s1', 'مانتو');
    await eng.searchProducts('s1');
    const wheres = [...findFirst.mock.calls, ...findMany.mock.calls, ...count.mock.calls].map((c) => c[0].where);
    expect(wheres.length).toBeGreaterThan(0);
    for (const w of wheres) expect(w).toMatchObject({ storeId: 's1', status: 'ACTIVE' });
  });
});
