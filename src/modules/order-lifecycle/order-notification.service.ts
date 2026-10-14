import { Injectable } from '@nestjs/common';
import { Order, OrderActor, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { BuyerNotificationTemplate } from '../notifications/notification.types';

const TEMPLATE_BY_STATUS: Partial<Record<OrderStatus, BuyerNotificationTemplate>> =
  {
    APPROVED: 'ORDER_APPROVED',
    SHIPPED: 'ORDER_SHIPPED',
    REJECTED: 'ORDER_REJECTED',
    CANCELLED: 'ORDER_CANCELLED',
  };

// نگاشت رویدادهای چرخه‌ی سفارش به قالب‌های NotificationService (3.7). منطق ارسال/کانال/
// dedupe/ساعت سکوت داخل NotificationService است؛ اینجا فقط «کدام رویداد، کدام قالب».
@Injectable()
export class OrderNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private async customerIdOf(order: Pick<Order, 'conversationId'>) {
    const conv = await this.prisma.salesConversation.findUnique({
      where: { id: order.conversationId },
      select: { customerId: true },
    });
    return conv?.customerId ?? null;
  }

  async onTransition(args: {
    order: Order;
    from: OrderStatus;
    to: OrderStatus;
    actor: OrderActor;
    reason?: string;
    refundId?: string | null;
    refundAmountToman?: number | null;
    refundStatus?: 'AWAITING_DESTINATION' | 'AWAITING_SELLER_CONFIRM' | null;
    paymentNotReceived?: boolean;
  }): Promise<void> {
    const template = args.paymentNotReceived
      ? 'PAYMENT_NOT_RECEIVED'
      : TEMPLATE_BY_STATUS[args.to];
    if (!template) return;
    const customerId = await this.customerIdOf(args.order);
    if (!customerId) return;
    await this.notifications.notifyBuyer({
      to: { customerId },
      template,
      entityId: args.order.id,
      data: {
        orderId: args.order.id,
        reason: args.reason,
        carrier: args.order.carrier,
        trackingCode: args.order.trackingCode,
        refundAmountToman: args.paymentNotReceived ? null : args.refundAmountToman,
      },
    });
    if (
      args.refundId &&
      args.refundAmountToman &&
      args.refundStatus === 'AWAITING_DESTINATION'
    ) {
      await this.notifications.notifyBuyer({
        to: { customerId },
        template: 'REFUND_DESTINATION_REQUEST',
        entityId: args.refundId,
        data: {
          orderId: args.order.id,
          refundAmountToman: args.refundAmountToman,
          refundId: args.refundId,
        },
      });
    }
  }

  async onRefundCancelled(order: Order): Promise<void> {
    const customerId = await this.customerIdOf(order);
    if (!customerId) return;
    await this.notifications.notifyBuyer({
      to: { customerId },
      template: 'REFUND_CANCELLED',
      entityId: order.id,
      data: { orderId: order.id },
    });
  }

  async onPlaced(order: Pick<Order, 'id' | 'conversationId'>): Promise<void> {
    const customerId = await this.customerIdOf(order);
    if (!customerId) return;
    await this.notifications.notifyBuyer({
      to: { customerId },
      template: 'ORDER_PLACED',
      entityId: order.id,
      data: { orderId: order.id },
    });
  }

  async onPaymentReminder(
    order: Pick<Order, 'id' | 'conversationId'>,
    hoursLeft: number,
  ): Promise<void> {
    const customerId = await this.customerIdOf(order);
    if (!customerId) return;
    await this.notifications.notifyBuyer({
      to: { customerId },
      template: 'PAYMENT_REMINDER',
      entityId: order.id,
      data: { orderId: order.id, hoursLeft },
    });
  }
}
