import { StoreService } from './store.service';

describe('seller dashboard excludes test chats [F4]', () => {
  it('شمارش سفارش و درآمد مکالمه‌ی تستی را نمی‌آورند', async () => {
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma,
      getOwned: jest.fn(async () => ({ id: 'store-1' })),
    });
    await svc.getDashboard('seller-1', 'store-1');
    expect(prisma.order.findMany.mock.calls[0][0].where.conversation).toEqual({
      isTest: false,
    });
    for (const call of prisma.order.groupBy.mock.calls) {
      expect(call[0].where.conversation).toEqual({ isTest: false });
    }
  });
});
