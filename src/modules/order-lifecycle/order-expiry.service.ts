import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStateService } from './order-state.service';
import { OrderNotificationService } from './order-notification.service';
import {
  ORDER_EXPIRY_BATCH_SIZE,
  ORDER_EXPIRY_SILENT_AFTER_DAYS,
  ORDER_PAYMENT_REMINDER_AFTER_HOURS,
} from '../../common/constants/sales-ops.constants';
import { fa } from '../../i18n/fa';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// docs/PRD-nivo-sales-unified.md 3.10 — انقضای سفارش پرداخت‌نشده: یادآوری بعد از ۲ ساعت
// (یک‌بار)، و بعد از `paymentDueAt` (createdAt+۲۴ساعت) → CANCELLED با actor=SYSTEM (کد تخفیف
// آزاد می‌شود). از cron Bull (repeatable) صدا زده می‌شود؛ هر پاس دسته‌ای و idempotent است.
@Injectable()
export class OrderExpiryService {
  private readonly logger = new Logger(OrderExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    private readonly notifications: OrderNotificationService,
  ) {}

  async run(now: Date = new Date()): Promise<{ reminded: number; expired: number }> {
    const reminded = await this.sendReminders(now);
    const expired = await this.expireOverdue(now);
    return { reminded, expired };
  }

  async sendReminders(now: Date): Promise<number> {
    const candidates = await this.prisma.order.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        paymentReminderSentAt: null,
        paymentDueAt: { gt: now },
        createdAt: {
          lte: new Date(now.getTime() - ORDER_PAYMENT_REMINDER_AFTER_HOURS * HOUR_MS),
          gt: new Date(now.getTime() - ORDER_EXPIRY_SILENT_AFTER_DAYS * DAY_MS),
        },
      },
      select: { id: true, conversationId: true, paymentDueAt: true },
      orderBy: { createdAt: 'asc' },
      take: ORDER_EXPIRY_BATCH_SIZE,
    });
    let count = 0;
    for (const o of candidates) {
      // claim اتمیک: فقط یک پاس/replica یادآوری را می‌فرستد
      const claimed = await this.prisma.order.updateMany({
        where: { id: o.id, status: 'PENDING_PAYMENT', paymentReminderSentAt: null },
        data: { paymentReminderSentAt: now },
      });
      if (claimed.count === 0) continue;
      const hoursLeft = Math.max(
        1,
        Math.round(((o.paymentDueAt?.getTime() ?? now.getTime()) - now.getTime()) / HOUR_MS),
      );
      await this.notifications.onPaymentReminder(o, hoursLeft);
      count++;
    }
    return count;
  }

  async expireOverdue(now: Date): Promise<number> {
    const overdue = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', paymentDueAt: { lte: now } },
      select: { id: true, createdAt: true },
      orderBy: { paymentDueAt: 'asc' },
      take: ORDER_EXPIRY_BATCH_SIZE,
    });
    let count = 0;
    for (const o of overdue) {
      try {
        const r = await this.state.transition({
          orderId: o.id,
          to: 'CANCELLED',
          actor: 'SYSTEM',
          channel: 'CRON',
          reason: fa.order.expiredReason,
          // سفارش‌های خیلی قدیمی (backfill) بی‌صدا لغو می‌شوند، بدون پیام به خریدار
          silent: now.getTime() - o.createdAt.getTime() > ORDER_EXPIRY_SILENT_AFTER_DAYS * DAY_MS,
        });
        if (r.changed) count++;
      } catch (err) {
        // خریدار همین لحظه رسید فرستاده یا فروشنده تایید کرده → عادی است
        if (err instanceof ConflictException) continue;
        this.logger.error(`expire failed (order=${o.id})`, err as Error);
      }
    }
    return count;
  }
}
