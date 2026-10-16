import { NotificationService } from './notification.service';
import { NotificationDeliveryService } from './notification-delivery.service';

// DEMO-2 — فروشگاه دمو هیچ SMS/تلگرامی ندارد
describe('demo store notifications', () => {
  it('notifySeller برای فروشگاه دمو چیزی نمی‌فرستد', async () => {
    const sendText = jest.fn();
    const sendFreeText = jest.fn();
    const svc = Object.create(NotificationService.prototype) as NotificationService;
    Object.assign(svc, {
      redis: { set: async () => 'OK' },
      prisma: {
        store: {
          findUnique: async () => ({ isDemo: true, sellerBotChatId: 'chat', seller: { phone: '0912' } }),
        },
        notificationLog: { create: async () => ({}) },
      },
      sellerBotApi: { sendText },
      sms: { sendFreeText },
      logger: { error: jest.fn() },
    });
    await svc.notifySeller({ storeId: 's', template: 'T', botText: 'b', smsText: 's' });
    expect(sendText).not.toHaveBeenCalled();
    expect(sendFreeText).not.toHaveBeenCalled();
  });

  it('deliver: SMS سفارش دمو رد می‌شود و تلگرام به خریدار نمی‌رود', async () => {
    const sendFreeText = jest.fn();
    const telegramSend = jest.fn();
    const logCreate = jest.fn(async () => ({}));
    const svc = Object.create(NotificationDeliveryService.prototype) as NotificationDeliveryService;
    Object.assign(svc, {
      prisma: {
        order: {
          findUnique: async () => ({
            id: 'o1', orderCode: null, totalAmount: 1, recipientPhone: '0912', conversationId: 'c1',
            store: { name: 'n', isDemo: true },
          }),
        },
        customer: {
          findUnique: async () => ({ id: 'cu', channel: 'TELEGRAM', telegramChatId: '1', phone: '0912', phoneVerifiedAt: new Date() }),
        },
        conversationEvent: { create: jest.fn(async () => ({})) },
        notificationLog: { create: logCreate },
      },
      sms: { sendFreeText },
      telegramApi: { sendText: telegramSend },
      logger: { error: jest.fn(), warn: jest.fn() },
    });
    const base = { template: 'ORDER_APPROVED', customerId: 'cu', entityId: 'o1', data: { orderId: 'o1' } } as any;
    await svc.deliver({ ...base, channel: 'SMS' });
    await svc.deliver({ ...base, channel: 'CHAT' });
    expect(sendFreeText).not.toHaveBeenCalled();
    expect(telegramSend).not.toHaveBeenCalled();
  });
});
