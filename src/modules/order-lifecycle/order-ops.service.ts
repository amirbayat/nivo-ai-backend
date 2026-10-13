import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { displayOrderCode } from '../../common/utils/order-code.util';
import { fa } from '../../i18n/fa';
import {
  DELIVERY_CONFIRM_AFTER_DAYS,
  RECEIPT_SLA_BUSINESS_HOURS,
  RECEIPT_SLA_LOOKBACK_DAYS,
  RECEIPT_SLA_MIN_SAMPLES,
  REFUND_DESTINATION_PURGE_AFTER_DAYS,
  REFUND_DESTINATION_REMINDER_HOURS,
  REFUND_OVERDUE_HOURS,
} from '../../common/constants/sales-ops.constants';
import { addTehranBusinessHours } from './tehran-business-hours.util';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

@Injectable()
export class OrderOpsService {
  private readonly logger = new Logger(OrderOpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async run(now = new Date()): Promise<void> {
    await this.receiptSla(now);
    await this.refundReminders(now);
    await this.deliveryNudge(now);
    await this.purgeDestinations(now);
  }

  async receiptSla(now: Date): Promise<void> {
    const rows = await this.prisma.order.findMany({
      where: { status: 'RECEIPT_SUBMITTED' },
      select: { id: true, storeId: true, orderCode: true, updatedAt: true },
      take: 200,
    });
    for (const row of rows) {
      const due = addTehranBusinessHours(row.updatedAt, RECEIPT_SLA_BUSINESS_HOURS);
      if (due > now) continue;
      await this.notifications.notifySeller({
        storeId: row.storeId,
        template: 'SELLER_RECEIPT_OVERDUE',
        entityId: row.id,
        botText: fa.orderNotify.receiptOverdue(displayOrderCode(row)),
        dedupe: { key: `receipt-overdue:${row.id}`, ttlSeconds: 7 * 24 * 3600 },
      });
    }
  }

  async refundReminders(now: Date): Promise<void> {
    const rows = await this.prisma.orderRefund.findMany({
      where: { status: { in: ['AWAITING_DESTINATION', 'READY'] } },
      include: {
        order: { select: { id: true, orderCode: true, conversationId: true, totalAmount: true } },
      },
      take: 200,
    });
    for (const row of rows) {
      const ageH = (now.getTime() - row.createdAt.getTime()) / HOUR_MS;
      if (row.status === 'AWAITING_DESTINATION' && ageH >= REFUND_DESTINATION_REMINDER_HOURS) {
        const conv = await this.prisma.salesConversation.findUnique({
          where: { id: row.order.conversationId },
          select: { customerId: true },
        });
        if (!conv) continue;
        await this.notifications.notifyBuyer({
          to: { customerId: conv.customerId },
          template: 'REFUND_DESTINATION_REQUEST',
          entityId: `${row.id}:reminder`,
          data: {
            orderId: row.order.id,
            refundAmountToman: row.amountToman,
            refundId: row.id,
          },
          dedupe: { key: `refund-dest-reminder:${row.id}`, ttlSeconds: 24 * 3600 },
        });
      }
      if (row.status === 'READY' && ageH >= REFUND_OVERDUE_HOURS) {
        await this.notifications.notifySeller({
          storeId: row.storeId,
          template: 'SELLER_REFUND_OVERDUE',
          entityId: row.id,
          botText: fa.orderNotify.refundOverdue(
            displayOrderCode(row.order),
            row.amountToman,
          ),
          dedupe: { key: `refund-overdue:${row.id}`, ttlSeconds: 7 * 24 * 3600 },
        });
      }
    }
  }

  async deliveryNudge(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - DELIVERY_CONFIRM_AFTER_DAYS * DAY_MS);
    const rows = await this.prisma.order.findMany({
      where: { status: 'SHIPPED', shippedAt: { lte: cutoff } },
      select: { id: true, conversationId: true },
      take: 200,
    });
    for (const row of rows) {
      const conv = await this.prisma.salesConversation.findUnique({
        where: { id: row.conversationId },
        select: { customerId: true },
      });
      if (!conv) continue;
      await this.notifications.notifyBuyer({
        to: { customerId: conv.customerId },
        template: 'DELIVERY_CHECK',
        entityId: row.id,
        data: { orderId: row.id },
        dedupe: { key: `delivery-nudge:${row.id}`, ttlSeconds: 7 * 24 * 3600 },
      });
    }
  }

  async purgeDestinations(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - REFUND_DESTINATION_PURGE_AFTER_DAYS * DAY_MS);
    await this.prisma.orderRefund.updateMany({
      where: { status: 'DONE', paidAt: { lte: cutoff }, destinationEnc: { not: null } },
      data: { destinationEnc: null },
    });
  }
}

const etaCache = new Map<string, { at: number; label: string }>();

export async function approvalEtaLabel(
  prisma: PrismaService,
  storeId: string,
): Promise<string> {
  const hit = etaCache.get(storeId);
  if (hit && Date.now() - hit.at < 24 * HOUR_MS) return hit.label;
  const since = new Date(Date.now() - RECEIPT_SLA_LOOKBACK_DAYS * DAY_MS);
  const events = await prisma.orderStatusEvent.findMany({
    where: { to: 'APPROVED', createdAt: { gte: since }, order: { storeId } },
    select: { orderId: true, createdAt: true },
    take: 400,
  });
  const durations: number[] = [];
  for (const ev of events) {
    const prev = await prisma.orderStatusEvent.findFirst({
      where: { orderId: ev.orderId, to: 'RECEIPT_SUBMITTED', createdAt: { lte: ev.createdAt } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (prev) durations.push(ev.createdAt.getTime() - prev.createdAt.getTime());
  }
  let label: string = fa.orderNotify.etaFallback;
  if (durations.length >= RECEIPT_SLA_MIN_SAMPLES) {
    durations.sort((a, b) => a - b);
    const mid = durations[Math.floor(durations.length / 2)];
    const hours = Math.max(1, Math.round(mid / HOUR_MS));
    label = fa.orderNotify.etaHours(hours);
  }
  etaCache.set(storeId, { at: Date.now(), label });
  return label;
}
