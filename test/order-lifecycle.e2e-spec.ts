/* eslint-disable @typescript-eslint/require-await */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { OrderStateService } from '../src/modules/order-lifecycle/order-state.service';
import { OrderExpiryService } from '../src/modules/order-lifecycle/order-expiry.service';
import { StoreService } from '../src/modules/store/store.service';

// فاز ۳ (3.2، 3.3، 3.10) — ماشین وضعیت سفارش روی Postgres واقعی: approve دوگانه هم‌زمان فقط
// یک اثر دارد؛ ship روی PENDING رد می‌شود؛ reject بعد از approve موجودی/سقف کارت/کد تخفیف را
// برمی‌گرداند؛ رویدادهای تاریخچه؛ انقضای سفارش پرداخت‌نشده. بدون DATABASE_URL رد می‌شود.
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('OrderStateService + OrderExpiryService (Postgres واقعی)', () => {
  let prisma: PrismaClient;
  let state: OrderStateService;
  let expiry: OrderExpiryService;
  let sellerId: string;
  let storeId: string;
  let seq = 0;
  const notified: { kind: string; args: unknown[] }[] = [];

  const notifications = {
    onTransition: jest.fn(async (...args: unknown[]) => {
      notified.push({ kind: 'transition', args });
    }),
    onPaymentReminder: jest.fn(async (...args: unknown[]) => {
      notified.push({ kind: 'reminder', args });
    }),
    onPlaced: jest.fn(),
    onRefundCancelled: jest.fn(async (...args: unknown[]) => {
      notified.push({ kind: 'refund-cancelled', args });
    }),
  };

  type NewOrder = {
    status?: 'PENDING_PAYMENT' | 'RECEIPT_SUBMITTED' | 'APPROVED';
    qty?: number;
    total?: number;
    withCard?: boolean;
    withDiscount?: boolean;
    paymentDueAt?: Date | null;
    createdAt?: Date;
  };

  const newOrder = async (opts: NewOrder = {}) => {
    const n = seq++;
    const product = await prisma.product.create({
      data: {
        storeId,
        name: `p${n}`,
        basePrice: 1000,
        stock: 10,
      } as never,
    });
    const customer = await prisma.customer.create({
      data: { storeId, channel: 'WEB', sessionToken: `s${Date.now()}${n}` },
    });
    const conv = await prisma.salesConversation.create({
      data: { storeId, customerId: customer.id },
    });
    const card = opts.withCard
      ? await prisma.storeBankCard.create({
          data: {
            storeId,
            cardNumber: '6037997000000000',
            ownerName: 'x',
          } as never,
        })
      : null;
    const discount = opts.withDiscount
      ? await prisma.storeDiscountCode.create({
          data: {
            storeId,
            code: `OFF${Date.now()}${n}`,
            kind: 'PERCENT',
            value: 10,
            redemptionCount: 1,
          } as never,
        })
      : null;
    const qty = opts.qty ?? 2;
    const order = await prisma.order.create({
      data: {
        storeId,
        conversationId: conv.id,
        items: [
          { productId: product.id, name: product.name, unitPrice: 1000, qty },
        ],
        totalAmount: opts.total ?? 1000 * qty,
        status: opts.status ?? 'PENDING_PAYMENT',
        orderCode: `NVT${String(n).padStart(5, '0')}`.slice(0, 8),
        bankCardId: card?.id,
        discountCodeId: discount?.id,
        paymentDueAt:
          opts.paymentDueAt === undefined ? null : opts.paymentDueAt,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
    });
    return { order, product, card, discount, conv };
  };

  const stockOf = async (productId: string) =>
    (await prisma.product.findUniqueOrThrow({ where: { id: productId } }))
      .stock;
  const statusOf = async (id: string) =>
    (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
  const approve = (orderId: string) =>
    state.transition({
      orderId,
      to: 'APPROVED',
      actor: 'SELLER',
      actorId: sellerId,
    });

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: 30,
      }),
    });
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        email: `order-e2e-${Date.now()}@test.local`,
        referralCode: `o${Date.now()}`,
      } as never,
    });
    sellerId = user.id;
    storeId = `st_ord_${Date.now()}`;
    await prisma.store.create({
      data: { id: storeId, sellerId, slug: storeId, name: storeId },
    });
    state = new OrderStateService(prisma as never, notifications as never, {
      collectRestoreLines: async () => [],
      notifyRestocked: async () => undefined,
    } as never);
    expiry = new OrderExpiryService(
      prisma as never,
      state,
      notifications as never,
    );
  });

  afterAll(async () => {
    await prisma.store.deleteMany({ where: { sellerId } });
    await prisma.user.delete({ where: { id: sellerId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    notified.length = 0;
  });

  it('approve دوگانه هم‌زمان (وب + بات) → فقط یک اثر: موجودی و سقف کارت یک‌بار', async () => {
    const { order, product, card } = await newOrder({
      status: 'RECEIPT_SUBMITTED',
      qty: 3,
      total: 3000,
      withCard: true,
    });
    const results = await Promise.all([
      approve(order.id),
      approve(order.id),
      approve(order.id),
    ]);
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(await stockOf(product.id)).toBe(7);
    const c = await prisma.storeBankCard.findUniqueOrThrow({
      where: { id: card!.id },
    });
    expect(c.totalConfirmedToman).toBe(3000);
    const events = await prisma.orderStatusEvent.findMany({
      where: { orderId: order.id, to: 'APPROVED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actor: 'SELLER',
      from: 'RECEIPT_SUBMITTED',
    });
  });

  it('approve یک سفارش SHIPPED → رد می‌شود و موجودی دوباره کم نمی‌شود (باگ 3.2)', async () => {
    const { order, product } = await newOrder({ status: 'RECEIPT_SUBMITTED' });
    await approve(order.id);
    await state.transition({
      orderId: order.id,
      to: 'SHIPPED',
      actor: 'SELLER',
    });
    await expect(approve(order.id)).rejects.toBeInstanceOf(ConflictException);
    expect(await stockOf(product.id)).toBe(8);
    expect(await statusOf(order.id)).toBe('SHIPPED');
  });

  it('ship روی PENDING_PAYMENT / REJECTED رد می‌شود', async () => {
    const a = await newOrder();
    await expect(
      state.transition({ orderId: a.order.id, to: 'SHIPPED', actor: 'SELLER' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await state.transition({
      orderId: a.order.id,
      to: 'REJECTED',
      actor: 'SELLER',
    });
    await expect(
      state.transition({ orderId: a.order.id, to: 'SHIPPED', actor: 'SELLER' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reject بعد از approve → موجودی، سقف کارت و کد تخفیف برمی‌گردند؛ re-approve دوباره کم می‌کند', async () => {
    const { order, product, card, discount } = await newOrder({
      status: 'RECEIPT_SUBMITTED',
      qty: 2,
      total: 2000,
      withCard: true,
      withDiscount: true,
    });
    await approve(order.id);
    expect(await stockOf(product.id)).toBe(8);

    const rej = await state.transition({
      orderId: order.id,
      to: 'REJECTED',
      actor: 'SELLER',
      data: { rejectReason: 'ناموجود' },
    });
    expect(rej.refundRequired).toBe(true);
    expect(await stockOf(product.id)).toBe(10);
    expect(
      (
        await prisma.storeBankCard.findUniqueOrThrow({
          where: { id: card!.id },
        })
      ).totalConfirmedToman,
    ).toBe(0);
    expect(
      (
        await prisma.storeDiscountCode.findUniqueOrThrow({
          where: { id: discount!.id },
        })
      ).redemptionCount,
    ).toBe(0);
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
        .rejectReason,
    ).toBe('ناموجود');
    const conv = await prisma.salesConversation.findUniqueOrThrow({
      where: { id: order.conversationId },
    });
    expect(conv).toMatchObject({
      currentState: 'REJECTED',
      isMutedForHuman: true,
    });

    // فروشنده رد اشتباهی را اصلاح می‌کند
    await approve(order.id);
    expect(await stockOf(product.id)).toBe(8);
    expect(
      (
        await prisma.storeDiscountCode.findUniqueOrThrow({
          where: { id: discount!.id },
        })
      ).redemptionCount,
    ).toBe(1);
    expect(
      (
        await prisma.storeBankCard.findUniqueOrThrow({
          where: { id: card!.id },
        })
      ).totalConfirmedToman,
    ).toBe(2000);
  });

  it('رد بعد از رسید، تایید دوباره refund باز را لغو می‌کند؛ refund پرداخت‌شده تایید دوباره را رد می‌کند [F1]', async () => {
    const { order } = await newOrder({ status: 'RECEIPT_SUBMITTED' });
    await state.transition({
      orderId: order.id,
      to: 'REJECTED',
      actor: 'SELLER',
    });
    const openBefore = await prisma.orderRefund.count({
      where: {
        orderId: order.id,
        status: { in: ['AWAITING_DESTINATION', 'READY'] },
      },
    });
    expect(openBefore).toBe(1);
    await approve(order.id);
    const openAfter = await prisma.orderRefund.count({
      where: {
        orderId: order.id,
        status: { in: ['AWAITING_DESTINATION', 'READY'] },
      },
    });
    expect(openAfter).toBe(0);
    expect(notified.filter((n) => n.kind === 'refund-cancelled')).toHaveLength(1);

    const paid = await newOrder({ status: 'RECEIPT_SUBMITTED' });
    await state.transition({
      orderId: paid.order.id,
      to: 'REJECTED',
      actor: 'SELLER',
    });
    await prisma.orderRefund.updateMany({
      where: { orderId: paid.order.id },
      data: { status: 'DONE' },
    });
    await expect(approve(paid.order.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await statusOf(paid.order.id)).toBe('REJECTED');
  });

  it('رد بدون رسیدن پول refund نمی‌سازد؛ مبلغ جزئی همان است؛ لغو رسید منتظر تایید فروشنده می‌ماند [F2]', async () => {
    const missing = await newOrder({ status: 'RECEIPT_SUBMITTED', total: 4000 });
    const rejected = await state.transition({
      orderId: missing.order.id,
      to: 'REJECTED',
      actor: 'SELLER',
      data: { moneyReceived: false, rejectReason: 'جعلی' },
    });
    expect(rejected.paymentNotReceived).toBe(true);
    expect(rejected.refundId).toBeNull();
    expect(
      await prisma.orderRefund.count({ where: { orderId: missing.order.id } }),
    ).toBe(0);

    const partial = await newOrder({ status: 'RECEIPT_SUBMITTED', total: 4000 });
    const part = await state.transition({
      orderId: partial.order.id,
      to: 'REJECTED',
      actor: 'SELLER',
      data: { moneyReceived: true, refundAmountToman: 1500 },
    });
    expect(part.refundAmountToman).toBe(1500);
    expect(
      (
        await prisma.orderRefund.findFirstOrThrow({
          where: { orderId: partial.order.id },
        })
      ).amountToman,
    ).toBe(1500);

    const held = await newOrder({ status: 'RECEIPT_SUBMITTED' });
    const cancelled = await state.transition({
      orderId: held.order.id,
      to: 'CANCELLED',
      actor: 'BUYER',
      reason: 'لغو توسط خریدار',
      data: { refundHoldForSeller: true },
    });
    expect(cancelled.refundStatus).toBe('AWAITING_SELLER_CONFIRM');
  });

  it('reject از PENDING_PAYMENT: موجودی دست نمی‌خورد (کم نشده بود)، کد تخفیف آزاد می‌شود', async () => {
    const { order, product, discount } = await newOrder({ withDiscount: true });
    const r = await state.transition({
      orderId: order.id,
      to: 'REJECTED',
      actor: 'SELLER',
    });
    expect(r.refundRequired).toBe(false);
    expect(await stockOf(product.id)).toBe(10);
    expect(
      (
        await prisma.storeDiscountCode.findUniqueOrThrow({
          where: { id: discount!.id },
        })
      ).redemptionCount,
    ).toBe(0);
  });

  it('REJECTED → RECEIPT_SUBMITTED (رسید تازه) دلیل رد را پاک می‌کند و کد تخفیف را دوباره مصرف می‌کند؛ رد دوباره فقط یک‌بار آزاد می‌کند', async () => {
    const { order, discount } = await newOrder({ withDiscount: true });
    await state.transition({
      orderId: order.id,
      to: 'REJECTED',
      actor: 'SELLER',
      data: { rejectReason: 'مبلغ ناقص' },
    });
    await state.transition({
      orderId: order.id,
      to: 'RECEIPT_SUBMITTED',
      actor: 'BUYER',
      data: { receiptImageKey: 'k2.jpg', receiptType: 'IMAGE' },
    });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o).toMatchObject({
      status: 'RECEIPT_SUBMITTED',
      rejectReason: null,
      receiptImageKey: 'k2.jpg',
      receiptType: 'IMAGE',
    });
    const count = async () =>
      (
        await prisma.storeDiscountCode.findUniqueOrThrow({
          where: { id: discount!.id },
        })
      ).redemptionCount;
    expect(await count()).toBe(1);
    await state.transition({
      orderId: order.id,
      to: 'REJECTED',
      actor: 'SELLER',
    });
    expect(await count()).toBe(0);
  });

  it('مسیر کامل تا تحویل + تاریخچه‌ی رویدادها (3.3) + شرکت حمل/کد رهگیری', async () => {
    const { order } = await newOrder({ status: 'PENDING_PAYMENT' });
    await state.transition({
      orderId: order.id,
      to: 'RECEIPT_SUBMITTED',
      actor: 'BUYER',
      channel: 'WEB',
      data: { receiptImageKey: 'r.jpg' },
    });
    await approve(order.id);
    await state.transition({
      orderId: order.id,
      to: 'SHIPPED',
      actor: 'SELLER',
      data: { carrier: 'تیپاکس', trackingCode: 'T123' },
    });
    await state.transition({
      orderId: order.id,
      to: 'DELIVERED',
      actor: 'BUYER',
      channel: 'WEB',
    });
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o).toMatchObject({
      status: 'DELIVERED',
      carrier: 'تیپاکس',
      trackingCode: 'T123',
    });
    expect(o.approvedAt && o.shippedAt && o.deliveredAt).toBeTruthy();
    const ev = await prisma.orderStatusEvent.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(ev.map((e) => e.to)).toEqual([
      'RECEIPT_SUBMITTED',
      'APPROVED',
      'SHIPPED',
      'DELIVERED',
    ]);
    // پایانی است
    await expect(
      state.transition({ orderId: order.id, to: 'CANCELLED', actor: 'SELLER' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('اعلان فقط وقتی انتقال واقعاً انجام شد (changed) و silent نباشد', async () => {
    const { order } = await newOrder({ status: 'RECEIPT_SUBMITTED' });
    await approve(order.id);
    await approve(order.id); // تکراری
    expect(notified.filter((n) => n.kind === 'transition')).toHaveLength(1);
    const q = await newOrder();
    await state.transition({
      orderId: q.order.id,
      to: 'CANCELLED',
      actor: 'SYSTEM',
      silent: true,
    });
    expect(notified.filter((n) => n.kind === 'transition')).toHaveLength(1);
  });

  describe('انقضا و یادآوری (3.10)', () => {
    const hours = (h: number) => new Date(Date.now() - h * 3_600_000);

    it('بعد از مهلت → CANCELLED با actor=SYSTEM/CRON و آزادسازی کد تخفیف؛ قبل از مهلت دست نمی‌خورد', async () => {
      const overdue = await newOrder({
        withDiscount: true,
        paymentDueAt: new Date(Date.now() - 60_000),
        createdAt: hours(25),
      });
      const fresh = await newOrder({
        paymentDueAt: new Date(Date.now() + 3_600_000),
        createdAt: hours(1),
      });
      const withReceipt = await newOrder({
        status: 'RECEIPT_SUBMITTED',
        paymentDueAt: new Date(Date.now() - 60_000),
        createdAt: hours(30),
      });

      const r = await expiry.run();
      expect(r.expired).toBeGreaterThanOrEqual(1);
      expect(await statusOf(overdue.order.id)).toBe('CANCELLED');
      expect(await statusOf(fresh.order.id)).toBe('PENDING_PAYMENT');
      // خریدار رسید فرستاده → منقضی نمی‌شود
      expect(await statusOf(withReceipt.order.id)).toBe('RECEIPT_SUBMITTED');
      const ev = await prisma.orderStatusEvent.findFirstOrThrow({
        where: { orderId: overdue.order.id, to: 'CANCELLED' },
      });
      expect(ev).toMatchObject({ actor: 'SYSTEM', channel: 'CRON' });
      expect(
        (
          await prisma.storeDiscountCode.findUniqueOrThrow({
            where: { id: overdue.discount!.id },
          })
        ).redemptionCount,
      ).toBe(0);
      const cancelledAt = (
        await prisma.order.findUniqueOrThrow({
          where: { id: overdue.order.id },
        })
      ).cancelledAt;
      expect(cancelledAt).toBeTruthy();
    });

    it('اجرای دوباره idempotent است (cancel دوم اثری ندارد)', async () => {
      const o = await newOrder({
        paymentDueAt: new Date(Date.now() - 60_000),
        createdAt: hours(26),
      });
      await expiry.run();
      const before = await prisma.orderStatusEvent.count({
        where: { orderId: o.order.id },
      });
      await expiry.run();
      expect(
        await prisma.orderStatusEvent.count({ where: { orderId: o.order.id } }),
      ).toBe(before);
    });

    it('سفارش خیلی قدیمی (backfill) بی‌صدا لغو می‌شود، بدون اعلان به خریدار', async () => {
      const old = await newOrder({
        paymentDueAt: new Date(Date.now() - 60_000),
        createdAt: hours(24 * 10),
      });
      notified.length = 0;
      await expiry.run();
      expect(await statusOf(old.order.id)).toBe('CANCELLED');
      expect(
        notified.filter(
          (n) =>
            n.kind === 'transition' &&
            (n.args[0] as { order: { id: string } }).order.id === old.order.id,
        ),
      ).toHaveLength(0);
    });

    it('یادآوری بعد از ۲ ساعت دقیقاً یک‌بار (claim اتمیک، حتی با اجراهای هم‌زمان)', async () => {
      const o = await newOrder({
        paymentDueAt: new Date(Date.now() + 20 * 3_600_000),
        createdAt: hours(3),
      });
      const early = await newOrder({
        paymentDueAt: new Date(Date.now() + 23 * 3_600_000),
        createdAt: hours(1),
      });
      notified.length = 0;
      await Promise.all([expiry.run(), expiry.run(), expiry.run()]);
      const reminders = notified.filter(
        (n) =>
          n.kind === 'reminder' &&
          (n.args[0] as { id: string }).id === o.order.id,
      );
      expect(reminders).toHaveLength(1);
      expect(
        notified.filter(
          (n) =>
            n.kind === 'reminder' &&
            (n.args[0] as { id: string }).id === early.order.id,
        ),
      ).toHaveLength(0);
      const after = await prisma.order.findUniqueOrThrow({
        where: { id: o.order.id },
      });
      expect(after.paymentReminderSentAt).toBeTruthy();
    });
  });

  describe('جست‌وجوی سفارش فروشنده (3.4/3.5)', () => {
    const search = async (q: string) => {
      const svc = Object.create(StoreService.prototype) as StoreService;
      Object.assign(svc, {
        prisma,
        getOwned: async () => ({}),
      });
      return svc.listOrders(sellerId, storeId, undefined, q);
    };

    it('کد سفارش (با/بی خط تیره، حروف کوچک، ارقام فارسی)، شماره‌ی کامل و ۴ رقم آخر، نام', async () => {
      const a = await newOrder();
      await prisma.order.update({
        where: { id: a.order.id },
        data: {
          orderCode: 'NVK7M2QX',
          recipientName: 'علیرضا محمدی',
          recipientPhone: '09121234567',
        },
      });
      const ids = async (q: string) => (await search(q)).map((o) => o.id);
      expect(await ids('NV-K7M2QX')).toEqual([a.order.id]);
      expect(await ids('nv k7m2qx')).toEqual([a.order.id]);
      expect(await ids('K7M2QX')).toEqual([a.order.id]);
      expect(await ids('09121234567')).toEqual([a.order.id]);
      expect(await ids('۰۹۱۲۱۲۳۴۵۶۷')).toEqual([a.order.id]);
      expect(await ids('4567')).toEqual([a.order.id]);
      expect(await ids('علیرضا')).toEqual([a.order.id]);
      // کد ناموجود → خالی (فرانت «کد پیدا نشد» را نشان می‌دهد)
      expect(await ids('NV-ZZZZZZ')).toEqual([]);
    });
  });
});
