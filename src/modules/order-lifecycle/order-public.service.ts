import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderIssueReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { fa } from '../../i18n/fa';
import { displayOrderCode, normalizeOrderCodeInput } from '../../common/utils/order-code.util';
import {
  ORDER_LINK_RATE_PER_MINUTE,
  REFUND_NUDGE_COOLDOWN_HOURS,
  REFUND_OVERDUE_HOURS,
} from '../../common/constants/sales-ops.constants';
import { NotificationService } from '../notifications/notification.service';
import { OrderStateService } from './order-state.service';
import { RefundService } from './refund.service';
import { hashOrderToken, verifyOrderToken, orderLinkSecret } from './order-link.util';

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class OrderPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly state: OrderStateService,
    private readonly refunds: RefundService,
    private readonly notifications: NotificationService,
  ) {}

  async resolve(code: string, token: string | undefined, ip: string) {
    await this.limit(code, ip);
    const orderId = await this.orderIdFor(code, token);
    if (!orderId) throw new NotFoundException(fa.salesAgent.orderNotFound);
    return this.view(orderId);
  }

  async setDestination(code: string, token: string | undefined, ip: string, refundId: string, raw: string, holderName: string) {
    const orderId = await this.guard(code, token, ip);
    return this.refunds.setDestination({ refundId, orderId, raw, holderName });
  }

  async cancel(code: string, token: string | undefined, ip: string) {
    const orderId = await this.guard(code, token, ip);
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || (order.status !== 'PENDING_PAYMENT' && order.status !== 'RECEIPT_SUBMITTED')) {
      throw new BadRequestException(fa.order.invalidTransition);
    }
    const r = await this.state.transition({
      orderId,
      to: 'CANCELLED',
      actor: 'BUYER',
      channel: 'WEB',
      reason: fa.order.buyerCancelReason,
      ...(order.status === 'RECEIPT_SUBMITTED'
        ? { data: { refundHoldForSeller: true } }
        : {}),
    });
    await this.notifications.notifySeller({
      storeId: order.storeId,
      template: 'ORDER_CANCELLED',
      entityId: order.id,
      botText: fa.orderNotify.sellerOrderCancelled(displayOrderCode(order)),
      smsText: fa.orderNotify.sellerOrderCancelledSms(displayOrderCode(order)),
    });
    return { status: r.order.status };
  }

  async confirmDelivery(code: string, token: string | undefined, ip: string) {
    const orderId = await this.guard(code, token, ip);
    const r = await this.state.transition({
      orderId,
      to: 'DELIVERED',
      actor: 'BUYER',
      channel: 'WEB',
    });
    return { status: r.order.status };
  }

  async reportIssue(
    code: string,
    token: string | undefined,
    ip: string,
    reason: OrderIssueReason,
    text?: string,
  ) {
    const orderId = await this.guard(code, token, ip);
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException(fa.salesAgent.orderNotFound);
    if (order.status !== 'APPROVED' && order.status !== 'SHIPPED' && order.status !== 'DELIVERED') {
      throw new BadRequestException(fa.order.issueTooEarly);
    }
    const open = await this.prisma.orderIssue.findFirst({
      where: { orderId, status: 'OPEN' },
      orderBy: { createdAt: 'asc' },
    });
    if (open) return { id: open.id, status: open.status };
    const issue = await this.prisma.orderIssue.create({
      data: { orderId, reason, text: text?.trim() || null },
    });
    await this.notifications.notifySeller({
      storeId: order.storeId,
      template: 'SELLER_ORDER_ISSUE',
      entityId: issue.id,
      botText: fa.orderNotify.sellerOrderIssue(displayOrderCode(order), reason),
      smsText: fa.orderNotify.sellerOrderIssueSms(displayOrderCode(order)),
    });
    return { id: issue.id, status: issue.status };
  }

  async nudge(code: string, token: string | undefined, ip: string, refundId: string) {
    const orderId = await this.guard(code, token, ip);
    const refund = await this.prisma.orderRefund.findFirst({
      where: { id: refundId, orderId, status: 'READY' },
    });
    if (!refund) throw new NotFoundException(fa.order.refundNotFound);
    const age = Date.now() - refund.createdAt.getTime();
    if (age < REFUND_OVERDUE_HOURS * HOUR_MS) {
      throw new BadRequestException(fa.order.refundNudgeTooSoon);
    }
    const key = `refund:nudge:${refund.id}`;
    const first = await this.redis.set(key, '1', 'EX', REFUND_NUDGE_COOLDOWN_HOURS * 3600, 'NX');
    if (first !== 'OK') throw new BadRequestException(fa.order.refundNudgeTooSoon);
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    await this.notifications.notifySeller({
      storeId: refund.storeId,
      template: 'SELLER_REFUND_OVERDUE',
      entityId: refund.id,
      botText: fa.orderNotify.refundNudge(displayOrderCode(order ?? { id: orderId }), refund.amountToman),
      smsText: fa.orderNotify.refundNudgeSms(displayOrderCode(order ?? { id: orderId })),
    });
    return { ok: true };
  }

  private async guard(code: string, token: string | undefined, ip: string) {
    await this.limit(code, ip);
    const orderId = await this.orderIdFor(code, token);
    if (!orderId) throw new ForbiddenException(fa.order.linkInvalid);
    return orderId;
  }

  private async limit(code: string, ip: string) {
    const key = `olink:${ip}:${code}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 60);
    if (n > ORDER_LINK_RATE_PER_MINUTE) throw new ForbiddenException(fa.order.linkInvalid);
  }

  private async orderIdFor(rawCode: string, token: string | undefined): Promise<string | null> {
    const code = rawCode.trim().toUpperCase().replace(/-/g, '');
    const link = await this.prisma.shortLink.findUnique({ where: { code } });
    if (link && link.expiresAt > new Date()) return link.orderId;
    const secret = orderLinkSecret();
    if (!token || !secret) return null;
    const verified = verifyOrderToken(token, secret);
    if (!verified) return null;
    const orderCode = normalizeOrderCodeInput(rawCode);
    const order = orderCode
      ? await this.prisma.order.findFirst({ where: { orderCode }, select: { id: true } })
      : null;
    if (!order || order.id !== verified.orderId) return null;
    const hash = hashOrderToken(token);
    const hashed = await this.prisma.shortLink.findFirst({
      where: { orderId: order.id, tokenHash: hash, expiresAt: { gt: new Date() } },
    });
    return hashed ? order.id : null;
  }

  private async view(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        store: { select: { name: true, slug: true } },
        statusEvents: { orderBy: { createdAt: 'asc' } },
        refunds: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException(fa.salesAgent.orderNotFound);
    const now = Date.now();
    const awaiting = order.refunds.find((r) => r.status === 'AWAITING_DESTINATION');
    return {
      orderCode: displayOrderCode(order),
      status: order.status,
      totalAmount: order.totalAmount,
      storeName: order.store.name,
      storeSlug: order.store.slug,
      carrier: order.carrier,
      trackingCode: order.trackingCode,
      items: order.items,
      timeline: order.statusEvents.map((e) => ({
        to: e.to,
        at: e.createdAt,
        reason: e.reason,
      })),
      refunds: order.refunds.map((r) => ({
        id: r.id,
        amountToman: r.amountToman,
        reason: r.reason,
        status: r.status,
        destinationMasked: r.destinationMasked,
        bankName: r.bankName,
        holderName: r.holderName,
        paidRef: r.paidRef,
        overdue: r.status === 'READY' && now - r.createdAt.getTime() > REFUND_OVERDUE_HOURS * HOUR_MS,
      })),
      actions: {
        canCancel: order.status === 'PENDING_PAYMENT' || order.status === 'RECEIPT_SUBMITTED',
        canConfirmDelivery: order.status === 'SHIPPED',
        canReportIssue: order.status === 'SHIPPED' || order.status === 'DELIVERED' || order.status === 'APPROVED',
        awaitingDestinationRefundId: awaiting?.id ?? null,
      },
    };
  }
}
