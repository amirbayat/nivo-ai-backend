import { OrderOpsService } from './order-ops.service';

const NOW = new Date('2026-10-14T08:00:00.000Z');

describe('OrderOpsService reminders [F19]', () => {
  it('uses the receipt-submitted time and reads every page [F19]', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `o${String(i).padStart(3, '0')}`);
    const rows = ids.map((id) => ({
      id,
      storeId: 's1',
      orderCode: 'NVK7M2QX',
      updatedAt: NOW,
    }));
    const findMany = jest.fn(async (args: {
      take?: number;
      where?: { id?: { gt: string } };
      orderBy?: { id: 'asc' };
    }) => {
      // سطرهای پردازش‌شده ممکن است دیگر با where نخوانند؛ صفحه‌بندی فقط با id > آخرین id
      const after = args.where?.id?.gt;
      const start = after ? ids.indexOf(after) + 1 : 0;
      return rows.slice(start, start + (args.take ?? rows.length));
    });
    const notifySeller = jest.fn(async () => undefined);
    const prisma = {
      order: { findMany },
      orderStatusEvent: {
        findMany: jest.fn(async (args: { where: { orderId: { in: string[] } } }) =>
          args.where.orderId.in.map((orderId) => ({
            orderId,
            createdAt: new Date('2026-10-01T08:00:00.000Z'),
          })),
        ),
      },
    };
    const svc = Object.create(OrderOpsService.prototype) as OrderOpsService;
    Object.assign(svc, { prisma, notifications: { notifySeller, notifyBuyer: jest.fn() } });
    await svc.receiptSla(NOW);
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ id: 'asc' });
    for (const [args] of findMany.mock.calls) {
      expect(args).not.toHaveProperty('cursor');
      expect(args).not.toHaveProperty('skip');
    }
    expect(notifySeller).toHaveBeenCalledTimes(201);
    expect(notifySeller).toHaveBeenCalledWith(
      expect.objectContaining({
        smsText: 'نیوو: رسید سفارش NV-K7M2QX هنوز بررسی نشده.',
      }),
    );
  });

  it('does not nag from an order edit that is newer than the receipt [F19]', async () => {
    const notifySeller = jest.fn(async () => undefined);
    const prisma = {
      order: {
        findMany: jest.fn(async () => [
          {
            id: 'o1',
            storeId: 's1',
            orderCode: 'NVK7M2QX',
            updatedAt: new Date('2026-10-01T08:00:00.000Z'),
          },
        ]),
      },
      orderStatusEvent: {
        findMany: jest.fn(async () => [
          { orderId: 'o1', createdAt: new Date('2026-10-14T07:50:00.000Z') },
        ]),
      },
    };
    const svc = Object.create(OrderOpsService.prototype) as OrderOpsService;
    Object.assign(svc, { prisma, notifications: { notifySeller } });
    await svc.receiptSla(NOW);
    expect(notifySeller).not.toHaveBeenCalled();
  });

  it('asks for the refund card once [F19]', async () => {
    let reminded = false;
    const notifyBuyer = jest.fn(async () => undefined);
    const prisma = {
      orderRefund: {
        findMany: jest.fn(async () =>
          reminded
            ? []
            : [
                {
                  id: 'r1',
                  storeId: 's1',
                  status: 'AWAITING_DESTINATION',
                  amountToman: 1000,
                  createdAt: new Date('2026-10-12T08:00:00.000Z'),
                  order: { id: 'o1', orderCode: 'NVK7M2QX', conversationId: 'c1', totalAmount: 1000 },
                },
              ],
        ),
        updateMany: jest.fn(async () => {
          reminded = true;
          return { count: 1 };
        }),
      },
      salesConversation: {
        findUnique: jest.fn(async () => ({ customerId: 'cust' })),
      },
    };
    const svc = Object.create(OrderOpsService.prototype) as OrderOpsService;
    Object.assign(svc, { prisma, notifications: { notifyBuyer, notifySeller: jest.fn() } });
    await svc.refundReminders(NOW);
    await svc.refundReminders(NOW);
    expect(notifyBuyer).toHaveBeenCalledTimes(1);
    expect(prisma.orderRefund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ destinationRemindedAt: null }),
      }),
    );
  });

  it('asks whether the order arrived once [F19]', async () => {
    let nudged = false;
    const notifyBuyer = jest.fn(async () => undefined);
    const prisma = {
      order: {
        findMany: jest.fn(async () =>
          nudged
            ? []
            : [{ id: 'o1', conversationId: 'c1', shippedAt: new Date('2026-10-01T08:00:00.000Z') }],
        ),
        updateMany: jest.fn(async () => {
          nudged = true;
          return { count: 1 };
        }),
      },
      salesConversation: {
        findUnique: jest.fn(async () => ({ customerId: 'cust' })),
      },
    };
    const svc = Object.create(OrderOpsService.prototype) as OrderOpsService;
    Object.assign(svc, { prisma, notifications: { notifyBuyer } });
    await svc.deliveryNudge(NOW);
    await svc.deliveryNudge(NOW);
    expect(notifyBuyer).toHaveBeenCalledTimes(1);
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deliveryCheckSentAt: null }),
      }),
    );
  });
});
