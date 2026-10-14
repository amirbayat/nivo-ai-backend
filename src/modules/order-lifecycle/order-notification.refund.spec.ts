import { OrderNotificationService } from './order-notification.service';
import { fa } from '../../i18n/fa';

describe('refund buyer copy [F2]', () => {
  const notifications = { notifyBuyer: jest.fn().mockResolvedValue(undefined) };
  const prisma = {
    salesConversation: {
      findUnique: jest.fn().mockResolvedValue({ customerId: 'c1' }),
    },
  };
  const svc = new OrderNotificationService(prisma as never, notifications as never);
  const order = {
    id: 'o1',
    conversationId: 'cv1',
    carrier: null,
    trackingCode: null,
  };

  beforeEach(() => notifications.notifyBuyer.mockClear());

  it('پول نرسیده: قالب جدا و بدون جمله‌ی بازپرداخت', async () => {
    await svc.onTransition({
      order: order as never,
      from: 'RECEIPT_SUBMITTED',
      to: 'REJECTED',
      actor: 'SELLER',
      paymentNotReceived: true,
    });
    expect(notifications.notifyBuyer).toHaveBeenCalledTimes(1);
    expect(notifications.notifyBuyer.mock.calls[0][0].template).toBe('PAYMENT_NOT_RECEIVED');
    expect(fa.orderNotify.paymentNotReceivedChat()).not.toContain('برمی‌گرد');
  });

  it('لغو با رسید: تا تایید فروشنده درخواست کارت نمی‌رود', async () => {
    await svc.onTransition({
      order: order as never,
      from: 'RECEIPT_SUBMITTED',
      to: 'CANCELLED',
      actor: 'BUYER',
      refundId: 'r1',
      refundAmountToman: 1000,
      refundStatus: 'AWAITING_SELLER_CONFIRM',
    });
    const templates = notifications.notifyBuyer.mock.calls.map((call) => call[0].template);
    expect(templates).toEqual(['ORDER_CANCELLED']);
  });
});
