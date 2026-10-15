import { StoreService } from './store.service';

describe('getBadges [R2.1]', () => {
  function build(over: Partial<Record<string, unknown>> = {}) {
    const prisma = {
      order: { count: jest.fn().mockResolvedValue(3) },
      salesConversation: { count: jest.fn().mockResolvedValue(2) },
      orderRefund: { count: jest.fn().mockResolvedValue(1) },
      product: { count: jest.fn().mockResolvedValue(1) },
      orderIssue: { count: jest.fn().mockResolvedValue(4) },
      $queryRaw: jest.fn().mockResolvedValue([{ count: 5 }]),
      ...over,
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma,
      getOwned: jest.fn(async () => ({ id: 'store-1' })),
    });
    return { svc, prisma };
  }

  it('شمارنده‌ها را فقط با count برمی‌گرداند و مکالمه‌ی تستی را نمی‌شمارد', async () => {
    const { svc, prisma } = build();
    const res = await svc.getBadges('seller-1', 'store-1');
    expect(res).toEqual({
      receipts: 3,
      attention: 2,
      issues: 4,
      refundsOverdue: 1,
      lowStock: 5,
      hasWeightProducts: true,
    });
    expect(prisma.order.count.mock.calls[0][0].where).toMatchObject({
      storeId: 'store-1',
      status: 'RECEIPT_SUBMITTED',
      conversation: { isTest: false },
    });
    expect(prisma.salesConversation.count.mock.calls[0][0].where).toMatchObject({
      storeId: 'store-1',
      isMutedForHuman: true,
      isTest: false,
    });
  });

  it('مالکیت را چک می‌کند (فروشنده‌ی دیگر ← خطا، بدون کوئری)', async () => {
    const { svc, prisma } = build();
    (svc as unknown as { getOwned: jest.Mock }).getOwned = jest
      .fn()
      .mockRejectedValue(new Error('forbidden'));
    await expect(svc.getBadges('other', 'store-1')).rejects.toThrow('forbidden');
    expect(prisma.order.count).not.toHaveBeenCalled();
  });
});
