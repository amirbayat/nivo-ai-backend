import { RefundService } from './refund.service';

describe('tryCaptureFromMessage [F7]', () => {
  it('یک کارت معتبر در چت، بازپرداخت منتظر مقصد را READY می‌کند', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const prisma: Record<string, unknown> = {
      $queryRaw: jest.fn(async () => []),
      orderRefund: {
        findFirst: jest.fn(async () => ({
          id: 'refund-1',
          orderId: 'order-1',
          storeId: 'store-1',
          amountToman: 1500,
          destinationMasked: null,
        })),
        updateMany,
      },
      order: {
        findUnique: jest.fn(async () => ({
          id: 'order-1',
          orderCode: 'NVABC123',
          conversationId: 'conv-1',
        })),
      },
      conversationEvent: {
        findMany: jest.fn(async () => []),
      },
    };
    prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
    const notifications = { notifySeller: jest.fn(async () => undefined) };
    const svc = Object.create(RefundService.prototype) as RefundService;
    Object.assign(svc, {
      prisma,
      notifications,
      key: () => 'test-key',
    });
    const result = await svc.tryCaptureFromMessage('conv-1', '4111111111111111');
    expect(result?.masked).toBeTruthy();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'AWAITING_DESTINATION' }),
      }),
    );
    expect(String(result?.reply)).toContain('ثبت شد');
  });

  it('متن معمولی کارت نیست و چیزی عوض نمی‌شود', async () => {
    const prisma = { orderRefund: { findFirst: jest.fn() } };
    const svc = Object.create(RefundService.prototype) as RefundService;
    Object.assign(svc, { prisma });
    await expect(svc.tryCaptureFromMessage('conv-1', 'سلام')).resolves.toBeNull();
    expect(prisma.orderRefund.findFirst).not.toHaveBeenCalled();
  });

  it('جمله‌ی طولانی حاوی ارقام کارت، کارت حساب نمی‌شود [R0.11]', async () => {
    const prisma = { orderRefund: { findFirst: jest.fn() } };
    const svc = Object.create(RefundService.prototype) as RefundService;
    Object.assign(svc, { prisma });
    await expect(
      svc.tryCaptureFromMessage(
        'conv-1',
        'سفارش من شماره ۱۲ بود و کارت ۴۱۱۱ ۱۱۱۱ ۱۱۱۱ ۱۱۱۱ را قبلاً دادم',
      ),
    ).resolves.toBeNull();
    expect(prisma.orderRefund.findFirst).not.toHaveBeenCalled();
  });
});
