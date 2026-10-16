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
const OPS_PAGE = 100;

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
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.order.findMany({
        where: { status: 'RECEIPT_SUBMITTED', ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true, storeId: true, orderCode: true },
        orderBy: { id: 'asc' },
        take: OPS_PAGE,
      });
      if (rows.length === 0) break;
      const events = await this.prisma.orderStatusEvent.findMany({
        where: { orderId: { in: rows.map((row) => row.id) }, to: 'RECEIPT_SUBMITTED' },
        orderBy: { createdAt: 'desc' },
        select: { orderId: true, createdAt: true },
      });
      const submittedAt = new Map<string, Date>();
      for (const event of events) {
        if (!submittedAt.has(event.orderId)) submittedAt.set(event.orderId, event.createdAt);
      }
      for (const row of rows) {
        const at = submittedAt.get(row.id);
        if (!at) continue;
        const due = addTehranBusinessHours(at, RECEIPT_SLA_BUSINESS_HOURS);
        if (due > now) continue;
        const code = displayOrderCode(row);
        await this.notifications.notifySeller({
          storeId: row.storeId,
          template: 'SELLER_RECEIPT_OVERDUE',
          entityId: row.id,
          botText: fa.orderNotify.receiptOverdue(code),
          smsText: fa.orderNotify.receiptOverdueSms(code),
          dedupe: { key: `receipt-overdue:${row.id}`, ttlSeconds: 7 * 24 * 3600 },
        });
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < OPS_PAGE) break;
    }
  }

  async refundReminders(now: Date): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.orderRefund.findMany({
        where: {
          OR: [
            { status: 'AWAITING_DESTINATION', destinationRemindedAt: null },
            { status: 'READY' },
          ],
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        include: {
          order: { select: { id: true, orderCode: true, conversationId: true, totalAmount: true } },
        },
        orderBy: { id: 'asc' },
        take: OPS_PAGE,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const ageH = (now.getTime() - row.createdAt.getTime()) / HOUR_MS;
        if (row.status === 'AWAITING_DESTINATION' && ageH >= REFUND_DESTINATION_REMINDER_HOURS) {
          const conv = await this.prisma.salesConversation.findUnique({
            where: { id: row.order.conversationId },
            select: { customerId: true },
          });
          if (!conv) continue;
          const claimed = await this.prisma.orderRefund.updateMany({
            where: { id: row.id, status: 'AWAITING_DESTINATION', destinationRemindedAt: null },
            data: { destinationRemindedAt: now },
          });
          if (claimed.count !== 1) continue;
          await this.notifications.notifyBuyer({
            to: { customerId: conv.customerId },
            template: 'REFUND_DESTINATION_REQUEST',
            entityId: `${row.id}:reminder`,
            data: {
              orderId: row.order.id,
              refundAmountToman: row.amountToman,
              refundId: row.id,
            },
          });
        }
        if (row.status === 'READY' && ageH >= REFUND_OVERDUE_HOURS) {
          const code = displayOrderCode(row.order);
          await this.notifications.notifySeller({
            storeId: row.storeId,
            template: 'SELLER_REFUND_OVERDUE',
            entityId: row.id,
            botText: fa.orderNotify.refundOverdue(code, row.amountToman),
            smsText: fa.orderNotify.refundOverdueSms(code),
            dedupe: { key: `refund-overdue:${row.id}`, ttlSeconds: 7 * 24 * 3600 },
          });
        }
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < OPS_PAGE) break;
    }
  }

  async deliveryNudge(now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - DELIVERY_CONFIRM_AFTER_DAYS * DAY_MS);
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.order.findMany({
        where: {
          status: 'SHIPPED',
          shippedAt: { lte: cutoff },
          deliveryCheckSentAt: null,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, conversationId: true },
        orderBy: { id: 'asc' },
        take: OPS_PAGE,
      });
      if (rows.length === 0) break;
      for (const row of rows) {
        const conv = await this.prisma.salesConversation.findUnique({
          where: { id: row.conversationId },
          select: { customerId: true },
        });
        if (!conv) continue;
        const claimed = await this.prisma.order.updateMany({
          where: { id: row.id, status: 'SHIPPED', deliveryCheckSentAt: null },
          data: { deliveryCheckSentAt: now },
        });
        if (claimed.count !== 1) continue;
        await this.notifications.notifyBuyer({
          to: { customerId: conv.customerId },
          template: 'DELIVERY_CHECK',
          entityId: row.id,
          data: { orderId: row.id },
        });
      }
      cursor = rows[rows.length - 1].id;
      if (rows.length < OPS_PAGE) break;
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

const etaCache = new Map<string, { at: number; label: string; hasData: boolean }>();

export async function approvalEtaLabel(
  prisma: PrismaService,
  storeId: string,
): Promise<string> {
  return (await approvalEta(prisma, storeId)).label;
}

// docs/PRD-buyer-chat-redesign.md B4 — «معمولاً X تایید می‌کنه» فقط وقتی نمونه‌ی کافی هست؛ وگرنه null
// (approvalEtaLabel همیشه یک متن fallback می‌دهد و برای پیام سفارش خوب است، نه برای صفحه‌ی اعتماد)
export async function approvalEtaOrNull(
  prisma: PrismaService,
  storeId: string,
): Promise<string | null> {
  const { label, hasData } = await approvalEta(prisma, storeId);
  return hasData ? label : null;
}

async function approvalEta(
  prisma: PrismaService,
  storeId: string,
): Promise<{ label: string; hasData: boolean }> {
  const hit = etaCache.get(storeId);
  if (hit && Date.now() - hit.at < 24 * HOUR_MS) return hit;
  const since = new Date(Date.now() - RECEIPT_SLA_LOOKBACK_DAYS * DAY_MS);
  const rows = await prisma.$queryRaw<{ samples: number; median_seconds: number | null }[]>`
    SELECT COUNT(*)::int AS samples,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (approved."createdAt" - submitted.submitted_at))
      ) AS median_seconds
    FROM order_status_events approved
    JOIN orders o ON o.id = approved."orderId"
    JOIN LATERAL (
      SELECT s."createdAt" AS submitted_at
      FROM order_status_events s
      WHERE s."orderId" = approved."orderId"
        AND s.to = 'RECEIPT_SUBMITTED'
        AND s."createdAt" <= approved."createdAt"
      ORDER BY s."createdAt" DESC
      LIMIT 1
    ) submitted ON true
    WHERE approved.to = 'APPROVED'
      AND approved."createdAt" >= ${since}
      AND o."storeId" = ${storeId}
  `;
  const samples = Number(rows[0]?.samples ?? 0);
  const medianSeconds = Number(rows[0]?.median_seconds ?? 0);
  let label: string = fa.orderNotify.etaFallback;
  let hasData = false;
  if (samples >= RECEIPT_SLA_MIN_SAMPLES && medianSeconds > 0) {
    const hours = Math.max(1, Math.round(medianSeconds / 3600));
    label = fa.orderNotify.etaHours(hours);
    hasData = true;
  }
  const entry = { at: Date.now(), label, hasData };
  etaCache.set(storeId, entry);
  return entry;
}
