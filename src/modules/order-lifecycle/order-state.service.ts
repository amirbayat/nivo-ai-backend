import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Order,
  OrderActor,
  OrderChannel,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { fa } from '../../i18n/fa';
import { canTransition, holdsStock } from './order-state.machine';
import { adjustOrderStock, StockShortage } from './order-stock.util';
import { OrderNotificationService } from './order-notification.service';
import { insertRefund } from './refund-tx';
import { RestockLine, StockAlertService } from './stock-alert.service';

export type TransitionInput = {
  orderId: string;
  to: OrderStatus;
  actor: OrderActor;
  actorId?: string;
  channel?: OrderChannel;
  reason?: string;
  // فقط فیلدهای مجاز هر انتقال؛ سایر فیلدهای سفارش از این مسیر نوشته نمی‌شوند
  data?: {
    rejectReason?: string | null;
    carrier?: string | null;
    trackingCode?: string | null;
    receiptImageKey?: string;
    receiptType?: 'IMAGE' | 'MANUAL_INFO';
    receiptManualInfo?: Prisma.InputJsonValue;
    refundAmountToman?: number | null;
    moneyReceived?: boolean;
    refundHoldForSeller?: boolean;
  };
  // اعلان به خریدار ارسال نشود (مثلاً لغو بی‌صدای سفارش‌های خیلی قدیمی)
  silent?: boolean;
};

export type TransitionResult = {
  order: Order;
  from: OrderStatus;
  // false = سفارش از قبل در همین وضعیت بود (دستور تکراری، بدون هیچ اثری)
  changed: boolean;
  stockWarnings: StockShortage[];
  // بعد از رسید/تایید رد یا لغو شد: پول احتمالاً پرداخت شده و باید بازپرداخت ساخته شود
  refundRequired: boolean;
  refundId: string | null;
  refundAmountToman: number | null;
  refundStatus: 'AWAITING_DESTINATION' | 'AWAITING_SELLER_CONFIRM' | null;
  paymentNotReceived: boolean;
  refundsCancelled: number;
  restocked: RestockLine[];
};

// docs/PRD-nivo-sales-unified.md 3.2 ⚠️ — تنها مسیر تغییر وضعیت سفارش (REST، بات تلگرام، cron،
// موتور چت). قفل ردیف سفارش (SELECT … FOR UPDATE) → اعتبارسنجی انتقال → آپدیت شرطی →
// اثرهای جانبی و OrderStatusEvent در همان تراکنش؛ بعد از commit اعلان‌ها (بهترین تلاش).
@Injectable()
export class OrderStateService {
  private readonly logger = new Logger(OrderStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: OrderNotificationService,
    private readonly stockAlerts: StockAlertService,
  ) {}

  async transition(input: TransitionInput): Promise<TransitionResult> {
    const result = await this.prisma.$transaction(
      (tx) => this.transitionInTx(tx, input),
      { maxWait: 5000, timeout: 15000 },
    );
    if (result.changed && !input.silent) {
      try {
        await this.notifications.onTransition({
          order: result.order,
          from: result.from,
          to: input.to,
          actor: input.actor,
          reason: input.reason ?? input.data?.rejectReason ?? undefined,
          refundId: result.refundId,
          refundAmountToman: result.refundAmountToman,
          refundStatus: result.refundStatus,
          paymentNotReceived: result.paymentNotReceived,
        });
      } catch (err) {
        this.logger.error(
          `order notification failed (order=${input.orderId} → ${input.to}) — transition is committed`,
          err as Error,
        );
      }
    }
    if (result.changed && !input.silent && result.refundsCancelled > 0) {
      try {
        await this.notifications.onRefundCancelled(result.order);
      } catch (err) {
        this.logger.error(
          `refund-cancelled notification failed (order=${input.orderId}) — transition is committed`,
          err as Error,
        );
      }
    }
    if (result.restocked.length > 0) {
      try {
        await this.stockAlerts.notifyRestocked(result.restocked);
      } catch (err) {
        this.logger.error(
          `stock alert failed (order=${input.orderId}) — transition is committed`,
          err as Error,
        );
      }
    }
    return result;
  }

  private async transitionInTx(
    tx: Prisma.TransactionClient,
    input: TransitionInput,
  ): Promise<TransitionResult> {
    const { orderId, to } = input;
    // قفل ردیف: دو انتقال هم‌زمان (وب + بات، دبل‌کلیک) پشت هم اجرا می‌شوند و `from` ثابت است
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const current = await tx.order.findUnique({ where: { id: orderId } });
    if (!current) throw new NotFoundException(fa.salesAgent.orderNotFound);
    const from = current.status;

    if (from === to) {
      return {
        order: current,
        from,
        changed: false,
        stockWarnings: [],
        refundRequired: false,
        refundId: null,
        refundAmountToman: null,
        refundStatus: null,
        paymentNotReceived: false,
        refundsCancelled: 0,
        restocked: [],
      };
    }
    if (!canTransition(from, to)) {
      throw new ConflictException(fa.order.invalidTransition);
    }

    if (from === 'REJECTED') {
      const paidBack = await tx.orderRefund.count({
        where: { orderId, status: 'DONE' },
      });
      if (paidBack > 0) {
        throw new ConflictException(fa.order.refundAlreadyPaid);
      }
    }

    const now = new Date();
    const data: Prisma.OrderUncheckedUpdateManyInput = { status: to };
    if (to === 'APPROVED') data.approvedAt = now;
    if (to === 'REJECTED') {
      data.rejectedAt = now;
      data.rejectReason = input.data?.rejectReason ?? null;
    }
    if (to === 'SHIPPED') {
      data.shippedAt = now;
      data.carrier = input.data?.carrier ?? null;
      data.trackingCode = input.data?.trackingCode ?? null;
    }
    if (to === 'DELIVERED') data.deliveredAt = now;
    if (to === 'CANCELLED') data.cancelledAt = now;
    if (to === 'RECEIPT_SUBMITTED') {
      if (input.data?.receiptImageKey)
        data.receiptImageKey = input.data.receiptImageKey;
      data.receiptType = input.data?.receiptType ?? 'IMAGE';
      if (input.data?.receiptManualInfo !== undefined)
        data.receiptManualInfo = input.data.receiptManualInfo;
      // رسید تازه بعد از رد: دلیل رد قبلی پاک می‌شود
      if (from === 'REJECTED') data.rejectReason = null;
    }

    // آپدیت شرطی (کمربند دوم بعد از قفل): فقط از وضعیتی که همین الان خواندیم
    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: from },
      data,
    });
    if (claimed.count === 0) throw new ConflictException(fa.order.stateChanged);

    // ── اثرهای جانبی ───────────────────────────────────────────────────────────
    let stockWarnings: StockShortage[] = [];
    let restocked: RestockLine[] = [];
    const holdsBefore = holdsStock(from);
    const holdsAfter = holdsStock(to);
    if (!holdsBefore && holdsAfter) {
      // تایید: سقف کارت (THRESHOLD)، کسر موجودی، مصرف کد تخفیف (اگر قبلاً آزاد شده بود)
      if (current.bankCardId) {
        await tx.storeBankCard.update({
          where: { id: current.bankCardId },
          data: { totalConfirmedToman: { increment: current.totalAmount } },
        });
      }
      stockWarnings = await adjustOrderStock(tx, current.items, 'DEDUCT');
    } else if (holdsBefore && !holdsAfter) {
      // رد/لغو بعد از تایید: برگشت موجودی و سقف کارت
      if (current.bankCardId) {
        await tx.$executeRaw`
          UPDATE store_bank_cards
          SET "totalConfirmedToman" = GREATEST(0, "totalConfirmedToman" - ${current.totalAmount})
          WHERE id = ${current.bankCardId}
        `;
      }
      restocked = await this.stockAlerts.collectRestoreLines(tx, current.items);
      await adjustOrderStock(tx, current.items, 'RESTORE');
    }
    if (from === 'REJECTED' && current.discountCodeId) {
      // خروج از REJECTED (تایید دوباره یا رسید تازه): مصرفی که با رد آزاد شده بود برمی‌گردد
      await this.reconsumeDiscount(tx, current.discountCodeId);
    }
    if ((to === 'REJECTED' || to === 'CANCELLED') && current.discountCodeId) {
      // رد/لغو از هر وضعیت: آزاد شدن مصرف کد تخفیف (انتقال‌ها متقارن‌اند: REJECTED→APPROVED
      // دوباره مصرف می‌کند و از REJECTED انتقال به CANCELLED وجود ندارد)
      await tx.$executeRaw`
        UPDATE store_discount_codes
        SET "redemptionCount" = GREATEST(0, "redemptionCount" - 1)
        WHERE id = ${current.discountCodeId}
      `;
    }

    // وضعیت مکالمه
    if (to === 'APPROVED') {
      // docs/PRD-conversation-history.md — تایید یعنی مکالمه واقعاً تمام شده
      await tx.salesConversation.update({
        where: { id: current.conversationId },
        data: { currentState: 'COMPLETED', archivedAt: now },
      });
    } else if (to === 'REJECTED') {
      // isMutedForHuman: بدون آن پیام بعدی خریدار به موتور رباتی می‌رفت که برای REJECTED
      // طراحی نشده؛ با mute پیام لاگ می‌شود و فروشنده در «نیاز به توجه» می‌بیند
      await tx.salesConversation.update({
        where: { id: current.conversationId },
        data: { currentState: 'REJECTED', archivedAt: now, isMutedForHuman: true },
      });
    } else if (to === 'CANCELLED') {
      // TODO(product): ConversationState مخصوص CANCELLED نداریم؛ مکالمه COMPLETED/archived
      // می‌شود (mute نمی‌شود تا خریدار بتواند دوباره سفارش بدهد — D-2)
      await tx.salesConversation.update({
        where: { id: current.conversationId },
        data: { currentState: 'COMPLETED', archivedAt: now },
      });
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId,
        from,
        to,
        actor: input.actor,
        actorId: input.actorId,
        channel: input.channel,
        reason: input.reason ?? input.data?.rejectReason ?? undefined,
      },
    });

    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const paidBefore =
      from === 'RECEIPT_SUBMITTED' || from === 'APPROVED' || !!current.receiptImageKey;
    const moneyMissing = input.data?.moneyReceived === false;
    const refundRequired = (to === 'REJECTED' || to === 'CANCELLED') && paidBefore && !moneyMissing;
    let refundId: string | null = null;
    let refundAmountToman: number | null = null;
    let refundStatus: 'AWAITING_DESTINATION' | 'AWAITING_SELLER_CONFIRM' | null = null;
    if (refundRequired) {
      const reason = to === 'REJECTED' ? 'ORDER_REJECTED' : 'ORDER_CANCELLED';
      const created = await insertRefund(
        tx,
        current,
        reason,
        input.actor === 'SELLER' ? 'SELLER' : 'SYSTEM',
        input.data?.refundAmountToman,
        input.reason ?? input.data?.rejectReason,
        input.data?.refundHoldForSeller ? 'AWAITING_SELLER_CONFIRM' : 'AWAITING_DESTINATION',
      );
      refundId = created?.id ?? null;
      refundAmountToman = created?.amountToman ?? null;
      refundStatus = created?.status ?? null;
    }
    let refundsCancelled = 0;
    if (from === 'REJECTED') {
      const cancelled = await tx.orderRefund.updateMany({
        where: {
          orderId,
          status: { in: ['AWAITING_DESTINATION', 'READY'] },
          reason: { in: ['ORDER_REJECTED', 'ORDER_CANCELLED'] },
        },
        data: { status: 'CANCELLED' },
      });
      refundsCancelled = cancelled.count;
    }
    return {
      order,
      from,
      changed: true,
      stockWarnings,
      refundRequired,
      refundId,
      refundAmountToman,
      refundStatus,
      paymentNotReceived: moneyMissing,
      refundsCancelled,
      restocked,
    };
  }

  private async reconsumeDiscount(
    tx: Prisma.TransactionClient,
    discountCodeId: string,
  ): Promise<void> {
    // سقف مصرف دوباره چک می‌شود ولی تایید فروشنده به‌خاطر آن مسدود نمی‌شود (سفارش از قبل
    // با همین کد ساخته شده بود)؛ اگر سقف پر بود، شمارنده فقط افزایش نمی‌یابد
    await tx.$executeRaw`
      UPDATE store_discount_codes
      SET "redemptionCount" = "redemptionCount" + 1
      WHERE id = ${discountCodeId}
        AND ("maxRedemptions" IS NULL OR "redemptionCount" < "maxRedemptions")
    `;
  }
}
