import { NotificationService } from './notification.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { invalidateSalesAgentGlobalConfigCache } from '../sales-agent/sales-agent-global-config.util';

// 3.6 — NotificationService: dedupe، کانال هر قالب، صف؛ NotificationDeliveryService: کلید
// rollout SMS، انتخاب شماره، سقف روزانه، پیام چت/تلگرام
class FakeRedis {
  store = new Map<string, string>();
  async set(k: string, v: string, ...args: unknown[]) {
    if (args.includes('NX') && this.store.has(k)) return null;
    this.store.set(k, v);
    return 'OK';
  }
  async incr(k: string) {
    const v = Number(this.store.get(k) ?? 0) + 1;
    this.store.set(k, String(v));
    return v;
  }
  async expire() {
    return 1;
  }
}

describe('NotificationService.notifyBuyer [3.6]', () => {
  const build = () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const redis = new FakeRedis();
    const svc = new NotificationService(
      queue as never,
      redis as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { svc, queue };
  };
  const input = {
    to: { customerId: 'c1' },
    template: 'ORDER_APPROVED' as const,
    entityId: 'o1',
    data: { orderId: 'o1' },
  };

  it('ORDER_APPROVED → دو job (CHAT و SMS) با retry', async () => {
    const { svc, queue } = build();
    await svc.notifyBuyer(input);
    expect(queue.add).toHaveBeenCalledTimes(2);
    const channels = queue.add.mock.calls.map((c) => c[1].channel).sort();
    expect(channels).toEqual(['CHAT', 'SMS']);
    expect(queue.add.mock.calls[0][2]).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential' },
    });
  });

  it('ORDER_PLACED فقط SMS است (کارت پرداخت خودش پیام چت است)', async () => {
    const { svc, queue } = build();
    await svc.notifyBuyer({ ...input, template: 'ORDER_PLACED' });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1].channel).toBe('SMS');
  });

  it('dedupe: همان قالب+entity در ۱۰ دقیقه دوباره صف نمی‌شود', async () => {
    const { svc, queue } = build();
    await svc.notifyBuyer(input);
    await svc.notifyBuyer(input);
    expect(queue.add).toHaveBeenCalledTimes(2);
    await svc.notifyBuyer({ ...input, entityId: 'o2' });
    expect(queue.add).toHaveBeenCalledTimes(4);
  });

  it('خطای صف هیچ‌وقت throw نمی‌کند', async () => {
    const { svc, queue } = build();
    queue.add.mockRejectedValue(new Error('redis down'));
    await expect(svc.notifyBuyer(input)).resolves.toBeUndefined();
  });
});

describe('NotificationDeliveryService [3.6]', () => {
  const order = {
    id: 'o1',
    orderCode: 'NVK7M2QX',
    totalAmount: 1_250_000,
    recipientPhone: '09120000000',
    conversationId: 'cv1',
    store: { name: 'فروشگاه تست' },
  };
  const build = (
    opts: {
      smsEnabled?: boolean;
      customer?: Record<string, unknown>;
      smsFails?: boolean;
    } = {},
  ) => {
    invalidateSalesAgentGlobalConfigCache();
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      customer: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          channel: 'WEB',
          telegramChatId: null,
          phone: null,
          phoneVerifiedAt: null,
          ...opts.customer,
        }),
      },
      conversationEvent: { create: jest.fn().mockResolvedValue({}) },
      notificationLog: { create: jest.fn().mockResolvedValue({}) },
      salesAgentGlobalConfig: {
        upsert: jest
          .fn()
          .mockResolvedValue({ orderSmsEnabled: opts.smsEnabled ?? true }),
      },
    };
    const sms = {
      sendFreeText: opts.smsFails
        ? jest.fn().mockRejectedValue(new Error('kavenegar'))
        : jest.fn().mockResolvedValue(undefined),
    };
    const telegram = { sendText: jest.fn().mockResolvedValue(undefined) };
    const svc = new NotificationDeliveryService(
      prisma as never,
      new FakeRedis() as never,
      sms as never,
      telegram as never,
    );
    return { svc, prisma, sms, telegram };
  };
  const job = (channel: 'CHAT' | 'SMS', template = 'ORDER_APPROVED') =>
    ({
      template,
      channel,
      customerId: 'c1',
      entityId: 'o1',
      data: { orderId: 'o1' },
    }) as never;
  const statuses = (prisma: ReturnType<typeof build>['prisma']) =>
    prisma.notificationLog.create.mock.calls.map((c) => c[0].data.status);

  it('CHAT: پیام با کد سفارش در گفتگو ثبت می‌شود', async () => {
    const { svc, prisma } = build();
    await svc.deliver(job('CHAT'));
    const payload = prisma.conversationEvent.create.mock.calls[0][0].data.payload;
    expect(payload.text).toContain('NV-K7M2QX');
    expect(statuses(prisma)).toEqual(['SENT']);
  });

  it('CHAT برای مشتری تلگرام: علاوه بر گفتگو، پیام تلگرام هم می‌رود', async () => {
    const { svc, telegram } = build({
      customer: { channel: 'TELEGRAM', telegramChatId: '555' },
    });
    await svc.deliver(job('CHAT'));
    expect(telegram.sendText).toHaveBeenCalledWith('555', expect.stringContaining('NV-K7M2QX'));
  });

  it('SMS خاموش (orderSmsEnabled=false) → ارسال نمی‌شود و SKIPPED_DISABLED ثبت می‌شود', async () => {
    const { svc, sms, prisma } = build({ smsEnabled: false });
    await svc.deliver(job('SMS'));
    expect(sms.sendFreeText).not.toHaveBeenCalled();
    expect(statuses(prisma)).toEqual(['SKIPPED_DISABLED']);
  });

  it('SMS: اول شماره‌ی تاییدشده، وگرنه گیرنده‌ی سفارش', async () => {
    const a = build({
      customer: { phone: '09351111111', phoneVerifiedAt: new Date() },
    });
    await a.svc.deliver(job('SMS'));
    expect(a.sms.sendFreeText).toHaveBeenCalledWith('09351111111', expect.any(String));
    const b = build({ customer: { phone: '09352222222' } });
    await b.svc.deliver(job('SMS'));
    expect(b.sms.sendFreeText).toHaveBeenCalledWith('09120000000', expect.any(String));
  });

  it('SMS بدون شماره → SKIPPED_NO_PHONE', async () => {
    const { svc, sms, prisma } = build();
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      ...order,
      recipientPhone: null,
    });
    await svc.deliver(job('SMS'));
    expect(sms.sendFreeText).not.toHaveBeenCalled();
    expect(statuses(prisma)).toEqual(['SKIPPED_NO_PHONE']);
  });

  it('سقف ۵ پیامک در روز برای هر شماره؛ ششمی SKIPPED_CAP', async () => {
    const { svc, sms, prisma } = build();
    for (let i = 0; i < 7; i++) await svc.deliver(job('SMS'));
    expect(sms.sendFreeText).toHaveBeenCalledTimes(5);
    expect(statuses(prisma).filter((s) => s === 'SKIPPED_CAP')).toHaveLength(2);
  });

  it('خطای ارسال SMS: FAILED ثبت و throw می‌شود تا Bull دوباره تلاش کند', async () => {
    const { svc, prisma } = build({ smsFails: true });
    await expect(svc.deliver(job('SMS'))).rejects.toThrow('kavenegar');
    expect(statuses(prisma)).toEqual(['FAILED']);
  });

  it('متن SMS کد سفارش و نام فروشگاه را دارد؛ ORDER_PLACED مبلغ و مهلت', async () => {
    const { svc, sms } = build();
    await svc.deliver(job('SMS', 'ORDER_PLACED'));
    const text = sms.sendFreeText.mock.calls[0][1] as string;
    expect(text).toContain('NV-K7M2QX');
    expect(text).toContain('فروشگاه تست');
    expect(text).toContain((1_250_000).toLocaleString('fa-IR'));
  });
});
