import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SmsService } from '../../sms/sms.service';
import { TelegramApiClientService } from '../telegram/telegram-api-client.service';
import { getSalesAgentGlobalConfig } from '../sales-agent/sales-agent-global-config.util';
import { displayOrderCode } from '../../common/utils/order-code.util';
import { tehranDateString, startOfTehranDay } from '../../common/utils/tehran-time.util';
import {
  NOTIFICATION_SMS_COST_TOMAN,
  NOTIFICATION_SMS_DAILY_CAP_PER_BUYER,
  ORDER_PAYMENT_WINDOW_HOURS,
} from '../../common/constants/sales-ops.constants';
import { fa } from '../../i18n/fa';
import { NotificationJob } from './notification.types';
import { ensureBuyerOrderLink } from '../order-lifecycle/order-link.util';

type OrderForNotify = {
  id: string;
  orderCode: string | null;
  totalAmount: number;
  recipientPhone: string | null;
  store: { name: string };
  conversationId: string;
};

// اجرای واقعی یک job اعلان خریدار (از پردازشگر Bull صدا زده می‌شود). خطای واقعی ارسال throw
// می‌شود تا Bull طبق attempts دوباره تلاش کند؛ «رد شدن» به‌دلیل قانون (خاموش بودن SMS، بدون
// شماره، سقف روزانه) خطا نیست و فقط در NotificationLog ثبت می‌شود.
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sms: SmsService,
    private readonly telegramApi: TelegramApiClientService,
  ) {}

  async deliver(job: NotificationJob): Promise<void> {
    if (job.template === 'BACK_IN_STOCK') {
      await this.deliverBackInStock(job);
      return;
    }
    const order = await this.prisma.order.findUnique({
      where: { id: job.data.orderId },
      select: {
        id: true,
        orderCode: true,
        totalAmount: true,
        recipientPhone: true,
        conversationId: true,
        store: { select: { name: true } },
      },
    });
    if (!order) return;
    const customer = await this.prisma.customer.findUnique({
      where: { id: job.customerId },
      select: {
        id: true,
        channel: true,
        telegramChatId: true,
        phone: true,
        phoneVerifiedAt: true,
      },
    });
    if (!customer) return;

    if (job.channel === 'CHAT') {
      await this.deliverChat(job, order, customer);
    } else {
      await this.deliverSms(job, order, customer);
    }
  }

  private async deliverBackInStock(job: NotificationJob): Promise<void> {
    const name = job.data.productName?.trim();
    if (!name) return;
    const customer = await this.prisma.customer.findUnique({
      where: { id: job.customerId },
      select: { id: true, phone: true, phoneVerifiedAt: true, channel: true, telegramChatId: true },
    });
    if (!customer) return;
    const text =
      job.channel === 'SMS'
        ? fa.orderNotify.backInStockSms(name, job.data.productUrl)
        : fa.orderNotify.backInStockChat(name, job.data.productUrl);
    if (job.channel === 'CHAT') {
      if (!job.data.conversationId) return;
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: job.data.conversationId,
          type: 'AGENT_REPLY',
          payload: { text },
        },
      });
      if (customer.channel === 'TELEGRAM' && customer.telegramChatId) {
        try {
          await this.telegramApi.sendText(customer.telegramChatId, text);
        } catch (err) {
          await this.log(job, 'TELEGRAM', `customer:${customer.id}`, 'FAILED', String(err));
          throw err;
        }
        await this.log(job, 'TELEGRAM', `customer:${customer.id}`, 'SENT');
      }
      await this.log(job, 'CHAT', `customer:${customer.id}`, 'SENT');
      return;
    }
    const config = await getSalesAgentGlobalConfig(this.prisma);
    if (!config.orderSmsEnabled) {
      await this.log(job, 'SMS', `customer:${customer.id}`, 'SKIPPED_DISABLED');
      return;
    }
    const phone = customer.phoneVerifiedAt ? customer.phone : null;
    if (!phone) {
      await this.log(job, 'SMS', `customer:${customer.id}`, 'SKIPPED_NO_PHONE');
      return;
    }
    const capKey = `notif:smscap:${phone}:${tehranDateString(startOfTehranDay())}`;
    const count = await this.redis.incr(capKey);
    if (count === 1) await this.redis.expire(capKey, 36 * 3600);
    if (count > NOTIFICATION_SMS_DAILY_CAP_PER_BUYER) {
      await this.log(job, 'SMS', phone, 'SKIPPED_CAP');
      return;
    }
    try {
      await this.sms.sendFreeText(phone, text);
    } catch (err) {
      await this.log(job, 'SMS', phone, 'FAILED', String(err));
      throw err;
    }
    await this.log(job, 'SMS', phone, 'SENT', undefined, NOTIFICATION_SMS_COST_TOMAN);
  }

  private async deliverChat(
    job: NotificationJob,
    order: OrderForNotify,
    customer: { id: string; channel: string; telegramChatId: string | null },
  ): Promise<void> {
    const text = await this.withLink(this.chatText(job, order), order.id);
    if (!text) return;
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: order.conversationId,
        type: 'AGENT_REPLY',
        payload: { text },
      },
    });
    if (customer.channel === 'TELEGRAM' && customer.telegramChatId) {
      try {
        await this.telegramApi.sendText(customer.telegramChatId, text);
      } catch (err) {
        await this.log(job, 'TELEGRAM', `customer:${customer.id}`, 'FAILED', String(err));
        throw err;
      }
      await this.log(job, 'TELEGRAM', `customer:${customer.id}`, 'SENT');
      return;
    }
    await this.log(job, 'CHAT', `customer:${customer.id}`, 'SENT');
  }

  private async deliverSms(
    job: NotificationJob,
    order: OrderForNotify,
    customer: { id: string; phone: string | null; phoneVerifiedAt: Date | null },
  ): Promise<void> {
    const text = await this.withLink(this.smsText(job, order), order.id);
    if (!text) return;
    const config = await getSalesAgentGlobalConfig(this.prisma);
    if (!config.orderSmsEnabled) {
      await this.log(job, 'SMS', `customer:${customer.id}`, 'SKIPPED_DISABLED');
      return;
    }
    // شماره‌ی تاییدشده‌ی مشتری، وگرنه گیرنده‌ی سفارش (فقط برای پیام‌های تراکنشی سفارش)
    const phone =
      (customer.phoneVerifiedAt ? customer.phone : null) ??
      order.recipientPhone ??
      customer.phone;
    if (!phone) {
      await this.log(job, 'SMS', `customer:${customer.id}`, 'SKIPPED_NO_PHONE');
      return;
    }
    const capKey = `notif:smscap:${phone}:${tehranDateString(startOfTehranDay())}`;
    const count = await this.redis.incr(capKey);
    if (count === 1) await this.redis.expire(capKey, 36 * 3600);
    if (count > NOTIFICATION_SMS_DAILY_CAP_PER_BUYER) {
      await this.log(job, 'SMS', phone, 'SKIPPED_CAP');
      return;
    }
    try {
      await this.sms.sendFreeText(phone, text);
    } catch (err) {
      await this.log(job, 'SMS', phone, 'FAILED', String(err));
      throw err;
    }
    await this.log(job, 'SMS', phone, 'SENT', undefined, NOTIFICATION_SMS_COST_TOMAN);
  }

  private chatText(job: NotificationJob, order: OrderForNotify): string | null {
    const code = displayOrderCode(order);
    const d = job.data;
    switch (job.template) {
      case 'PAYMENT_REMINDER':
        return fa.orderNotify.reminderChat(code, d.hoursLeft ?? 1);
      case 'ORDER_APPROVED':
        return fa.orderNotify.approvedChat(code);
      case 'ORDER_SHIPPED':
        return fa.orderNotify.shippedChat(code, d.carrier, d.trackingCode);
      case 'ORDER_REJECTED':
        return fa.orderNotify.rejectedChat(code, d.reason, d.refundAmountToman);
      case 'ORDER_CANCELLED':
        return fa.orderNotify.cancelledChat(code, d.reason);
      case 'REFUND_DESTINATION_REQUEST':
        return d.refundAmountToman ? fa.orderNotify.refundAskChat(d.refundAmountToman) : null;
      case 'REFUND_DONE':
        return d.refundAmountToman
          ? fa.orderNotify.refundDoneChat(d.refundAmountToman, d.destinationMasked, d.paidRef)
          : null;
      case 'RECEIPT_AMOUNT_MISMATCH':
        return d.receiptAmountToman != null && d.orderAmountToman != null
          ? fa.orderNotify.receiptMismatchChat(d.receiptAmountToman, d.orderAmountToman)
          : null;
      case 'DELIVERY_CHECK':
        return fa.orderNotify.deliveryCheckChat(code);
      default:
        return null;
    }
  }

  private smsText(job: NotificationJob, order: OrderForNotify): string | null {
    const code = displayOrderCode(order);
    const store = order.store.name;
    const d = job.data;
    switch (job.template) {
      case 'ORDER_PLACED':
        return fa.orderNotify.placedSms(
          code,
          store,
          order.totalAmount,
          ORDER_PAYMENT_WINDOW_HOURS,
        );
      case 'PAYMENT_REMINDER':
        return fa.orderNotify.reminderSms(code, store);
      case 'ORDER_APPROVED':
        return fa.orderNotify.approvedSms(code, store);
      case 'ORDER_SHIPPED':
        return fa.orderNotify.shippedSms(code, store, d.carrier, d.trackingCode);
      case 'ORDER_REJECTED':
        return fa.orderNotify.rejectedSms(code, store);
      case 'ORDER_CANCELLED':
        return fa.orderNotify.cancelledSms(code, store);
      case 'REFUND_DESTINATION_REQUEST':
        return d.refundAmountToman ? fa.orderNotify.refundAskSms(d.refundAmountToman) : null;
      case 'REFUND_DONE':
        return d.refundAmountToman
          ? fa.orderNotify.refundDoneSms(d.refundAmountToman, d.paidRef)
          : null;
      case 'DELIVERY_CHECK':
        return fa.orderNotify.deliveryCheckSms(code);
      default:
        return null;
    }
  }

  private async withLink(text: string | null, orderId: string): Promise<string | null> {
    if (!text) return null;
    try {
      const url = await ensureBuyerOrderLink(this.prisma, orderId);
      if (!url) return text;
      return `${text}\n${fa.orderNotify.profileLinkLine(url)}`;
    } catch (err) {
      this.logger.warn(`order link footer skipped: ${String(err)}`);
      return text;
    }
  }

  private async log(
    job: NotificationJob,
    channel: string,
    to: string,
    status: string,
    error?: string,
    costToman = 0,
  ): Promise<void> {
    await this.prisma.notificationLog
      .create({
        data: {
          template: job.template,
          channel,
          to,
          status,
          costToman,
          entityId: job.entityId,
          error: error?.slice(0, 500),
        },
      })
      .catch((err) =>
        this.logger.warn(`notification log write failed: ${String(err)}`),
      );
  }
}
