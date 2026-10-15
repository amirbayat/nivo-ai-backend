/* eslint-disable @typescript-eslint/require-await */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { OrderStateService } from '../src/modules/order-lifecycle/order-state.service';
import { OrderNotificationService } from '../src/modules/order-lifecycle/order-notification.service';
import { RefundService } from '../src/modules/order-lifecycle/refund.service';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service';
import { SalesAgentService } from '../src/modules/sales-agent/sales-agent.service';
import { ConversationEngineService } from '../src/modules/sales-agent/conversation-engine.service';

// R0.20 — F7 (رد با «پول رسیده» ← فرم کارت در چت ← ثبت کارت با session ← READY ← واریز شد)
// و F4 (چت تستی هرگز سفارش واقعی نمی‌سازد) روی Postgres واقعی. بدون DATABASE_URL رد می‌شود.
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('refund flow + test chat (Postgres واقعی) [R0.20]', () => {
  let prisma: PrismaClient;
  let sellerId: string;
  let storeId: string;
  let state: OrderStateService;
  let refunds: RefundService;
  let agent: SalesAgentService;
  const telegramSent: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 10 }),
    });
    await prisma.$connect();
    const user = await prisma.user.create({
      data: { email: `r020-${Date.now()}@test.local`, referralCode: `r${Date.now()}` } as never,
    });
    sellerId = user.id;
    storeId = `st_r020_${Date.now()}`;
    await prisma.store.create({ data: { id: storeId, sellerId, slug: storeId, name: storeId } });

    // اعلان چت واقعی: notifyBuyer همان job صف را مستقیم به NotificationDeliveryService می‌دهد (فقط CHAT)
    const delivery = new NotificationDeliveryService(
      prisma as never,
      { incr: async () => 1, expire: async () => 1 } as never,
      { sendFreeText: async () => undefined } as never,
      { sendText: async (_c: string, t: string) => void telegramSent.push(t) } as never,
    );
    const notifications = {
      notifyBuyer: async (input: {
        to: { customerId: string };
        template: string;
        entityId: string;
        data: unknown;
      }) => {
        await delivery.deliver({
          template: input.template,
          channel: 'CHAT',
          customerId: input.to.customerId,
          entityId: input.entityId,
          data: input.data,
        } as never);
      },
      notifySeller: async () => undefined,
    };
    state = new OrderStateService(
      prisma as never,
      new OrderNotificationService(prisma as never, notifications as never),
      { collectRestoreLines: async () => [], notifyRestocked: async () => undefined } as never,
    );
    refunds = new RefundService(
      prisma as never,
      { get: () => 'e2e-refund-key' } as never,
      notifications as never,
    );
    agent = Object.create(SalesAgentService.prototype) as SalesAgentService;
    Object.assign(agent, { prisma, refunds });
  });

  afterAll(async () => {
    await prisma.store.deleteMany({ where: { sellerId } });
    await prisma.user.delete({ where: { id: sellerId } });
    await prisma.$disconnect();
  });

  const makeConversation = async (opts: { isTest?: boolean } = {}) => {
    const token = `s${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const customer = await prisma.customer.create({
      data: { storeId, channel: 'WEB', sessionToken: token },
    });
    const conv = await prisma.salesConversation.create({
      data: { storeId, customerId: customer.id, isTest: !!opts.isTest },
    });
    return { token, customer, conv };
  };

  it('F7: رد با «پول رسیده» ← فرم کارت ← ثبت با session ← READY ← واریز کردم ← پیام «واریز شد»', async () => {
    const { token, conv } = await makeConversation();
    const order = await prisma.order.create({
      data: {
        storeId,
        conversationId: conv.id,
        items: [{ productId: 'p', name: 'کفش', unitPrice: 1000, qty: 2 }],
        totalAmount: 2000,
        status: 'RECEIPT_SUBMITTED',
        orderCode: `NVF7${Date.now() % 10000}`.slice(0, 8),
      },
    });

    await state.transition({
      orderId: order.id,
      to: 'REJECTED',
      actor: 'SELLER',
      actorId: sellerId,
      data: { moneyReceived: true, rejectReason: 'مغایرت' },
    });

    const events = await prisma.conversationEvent.findMany({
      where: { conversationId: conv.id, type: 'AGENT_REPLY' },
    });
    const form = events
      .map((e) => (e.payload as { uiBlock?: { type: string; refundId: string; status: string } }).uiBlock)
      .find((b) => b?.type === 'REFUND_DESTINATION_FORM');
    expect(form).toBeDefined();
    expect(form?.status).toBe('OPEN');

    // مکالمه‌ی سفارش ردشده بایگانی/mute است؛ فرم باید با session خریدار همچنان کار کند
    const saved = await agent.submitRefundDestination(
      conv.id,
      token,
      form!.refundId,
      '4111 1111 1111 1111',
      'علی رضایی',
    );
    expect(saved.status).toBe('READY');
    expect(
      (await prisma.orderRefund.findUniqueOrThrow({ where: { id: form!.refundId } })).status,
    ).toBe('READY');

    // session اشتباه ← ۴۰۳ و تغییری نمی‌کند
    await expect(
      agent.submitRefundDestination(conv.id, 'wrong-token', form!.refundId, '4111111111111111', 'x y'),
    ).rejects.toMatchObject({ status: 403 });

    await refunds.markPaid(sellerId, storeId, form!.refundId, 'TRK-1');
    expect(
      (await prisma.orderRefund.findUniqueOrThrow({ where: { id: form!.refundId } })).status,
    ).toBe('DONE');
    const after = await prisma.conversationEvent.findMany({
      where: { conversationId: conv.id, type: 'AGENT_REPLY' },
      orderBy: { createdAt: 'asc' },
    });
    const texts = after.map((e) => (e.payload as { text?: string }).text ?? '');
    expect(texts.some((t) => t.includes('واریز شد'))).toBe(true);
    const finalForm = after
      .map((e) => (e.payload as { uiBlock?: { type: string; status: string } }).uiBlock)
      .find((b) => b?.type === 'REFUND_DESTINATION_FORM');
    expect(finalForm?.status).toBe('PAID');
    // کارت کامل هرگز در رویدادها نیست
    expect(JSON.stringify(after.map((e) => e.payload))).not.toMatch(/4111\s?1111\s?1111\s?1111/);
  });

  it('F4: سبد پر در چت تستی ← سفارش ساخته نمی‌شود (۰ سفارش)', async () => {
    const { conv } = await makeConversation({ isTest: true });
    const product = await prisma.product.create({
      data: { storeId, name: 'تست', basePrice: 1000, stock: 5 } as never,
    });
    const engine = Object.create(ConversationEngineService.prototype) as unknown as {
      executeCreateOrder: (
        conversation: unknown,
        ctx: unknown,
      ) => Promise<{ status: string }>;
    };
    Object.assign(engine, { prisma });
    const result = await engine.executeCreateOrder(
      { ...conv, store: { id: storeId } },
      {
        cart: [{ productId: product.id, name: 'تست', unitPrice: 1000, qty: 1 }],
        appliedDiscount: null,
      },
    );
    expect(result.status).toBe('test_only');
    expect(await prisma.order.count({ where: { conversationId: conv.id } })).toBe(0);
  });
});
