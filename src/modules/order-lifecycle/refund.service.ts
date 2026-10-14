import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RefundReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { fa } from '../../i18n/fa';
import { encryptSecret, decryptSecret } from '../../common/utils/secret-cipher';
import { parseDestination } from '../../common/utils/refund-destination.util';
import { displayOrderCode } from '../../common/utils/order-code.util';
import { REFUND_OVERDUE_HOURS } from '../../common/constants/sales-ops.constants';
import { NotificationService } from '../notifications/notification.service';
import { insertRefund } from './refund-tx';

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class RefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationService,
  ) {}

  private key(): string {
    const k = this.config.get<string>('REFUND_DEST_KEY')?.trim();
    if (!k) throw new ServiceUnavailableException(fa.order.refundKeyMissing);
    return k;
  }

  async remaining(orderId: string, totalAmount: number): Promise<number> {
    const agg = await this.prisma.orderRefund.aggregate({
      where: { orderId, status: { not: 'CANCELLED' } },
      _sum: { amountToman: true },
    });
    return Math.max(0, totalAmount - (agg._sum.amountToman ?? 0));
  }

  async createManual(input: {
    sellerId: string;
    storeId: string;
    orderId: string;
    amountToman: number;
    reason: RefundReason;
    note?: string;
  }) {
    const order = await this.ownedOrder(input.sellerId, input.storeId, input.orderId);
    const row = await this.prisma.$transaction((tx) =>
      insertRefund(tx, order, input.reason, 'SELLER', input.amountToman, input.note),
    );
    if (!row) throw new BadRequestException(fa.order.refundAmountInvalid);
    const customerId = await this.customerId(order.conversationId);
    if (customerId) {
      await this.notifications.notifyBuyer({
        to: { customerId },
        template: 'REFUND_DESTINATION_REQUEST',
        entityId: row.id,
        data: { orderId: order.id, refundAmountToman: row.amountToman, refundId: row.id },
      });
    }
    return row;
  }

  async createOverpay(sellerId: string, storeId: string, orderId: string) {
    const order = await this.ownedOrder(sellerId, storeId, orderId);
    const check = order.receiptCheck as { overpaidToman?: number } | null;
    const amount = check?.overpaidToman ?? 0;
    if (amount < 1) throw new BadRequestException(fa.order.refundAmountInvalid);
    return this.createManual({
      sellerId,
      storeId,
      orderId,
      amountToman: amount,
      reason: 'OVERPAID',
    });
  }

  async setDestination(input: {
    refundId: string;
    orderId: string;
    raw: string;
    holderName: string;
  }) {
    const holder = input.holderName.trim();
    if (holder.length < 2 || holder.length > 80) {
      throw new BadRequestException(fa.order.refundHolderInvalid);
    }
    const parsed = parseDestination(input.raw);
    if (!parsed) throw new BadRequestException(fa.order.refundDestinationInvalid);
    const refund = await this.prisma.orderRefund.findFirst({
      where: { id: input.refundId, orderId: input.orderId, status: 'AWAITING_DESTINATION' },
    });
    if (!refund) throw new NotFoundException(fa.order.refundNotFound);
    await this.prisma.orderRefund.update({
      where: { id: refund.id },
      data: {
        status: 'READY',
        destinationType: parsed.type,
        destinationEnc: encryptSecret(parsed.plain, this.key()),
        destinationMasked: parsed.masked,
        holderName: holder,
        bankName: parsed.bankName,
        destinationAt: new Date(),
      },
    });
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      select: { orderCode: true, id: true },
    });
    await this.notifications.notifySeller({
      storeId: refund.storeId,
      template: 'REFUND_READY',
      entityId: refund.id,
      botText: fa.orderNotify.refundReadySeller(
        displayOrderCode(order ?? { id: input.orderId }),
        refund.amountToman,
        parsed.masked,
      ),
    });
    return { status: 'READY' as const, destinationMasked: parsed.masked, bankName: parsed.bankName };
  }

  async sellerSetDestination(
    sellerId: string,
    storeId: string,
    refundId: string,
    raw: string,
    holderName: string,
  ) {
    const refund = await this.ownedRefund(sellerId, storeId, refundId);
    return this.setDestination({
      refundId: refund.id,
      orderId: refund.orderId,
      raw,
      holderName,
    });
  }

  async markPaid(
    sellerId: string,
    storeId: string,
    refundId: string,
    paidRef?: string,
    proofImageKey?: string,
  ) {
    const refund = await this.ownedRefund(sellerId, storeId, refundId);
    if (refund.status !== 'READY' && refund.status !== 'AWAITING_DESTINATION') {
      throw new BadRequestException(fa.order.refundNotPayable);
    }
    const updated = await this.prisma.orderRefund.update({
      where: { id: refund.id },
      data: {
        status: 'DONE',
        paidAt: new Date(),
        paidRef: paidRef?.trim() || null,
        proofImageKey: proofImageKey ?? null,
      },
    });
    const order = await this.prisma.order.findUnique({
      where: { id: refund.orderId },
      select: { id: true, conversationId: true },
    });
    if (order) {
      const customerId = await this.customerId(order.conversationId);
      if (customerId) {
        await this.notifications.notifyBuyer({
          to: { customerId },
          template: 'REFUND_DONE',
          entityId: refund.id,
          data: {
            orderId: order.id,
            refundAmountToman: refund.amountToman,
            refundId: refund.id,
            paidRef: updated.paidRef,
            destinationMasked: refund.destinationMasked,
          },
        });
      }
    }
    return { id: updated.id, status: updated.status, paidAt: updated.paidAt, paidRef: updated.paidRef };
  }

  async resolveSellerHold(
    sellerId: string,
    storeId: string,
    refundId: string,
    moneyReceived: boolean,
  ) {
    const refund = await this.ownedRefund(sellerId, storeId, refundId);
    const next = moneyReceived ? 'AWAITING_DESTINATION' : 'CANCELLED';
    const updated = await this.prisma.orderRefund.updateMany({
      where: { id: refund.id, status: 'AWAITING_SELLER_CONFIRM' },
      data: { status: next },
    });
    if (updated.count !== 1) throw new ConflictException(fa.order.stateChanged);
    if (moneyReceived) {
      const order = await this.prisma.order.findUnique({
        where: { id: refund.orderId },
        select: { id: true, conversationId: true },
      });
      if (order) {
        const customerId = await this.customerId(order.conversationId);
        if (customerId) {
          await this.notifications.notifyBuyer({
            to: { customerId },
            template: 'REFUND_DESTINATION_REQUEST',
            entityId: refund.id,
            data: { orderId: order.id, refundAmountToman: refund.amountToman, refundId: refund.id },
          });
        }
      }
    }
    return { status: next };
  }

  async list(sellerId: string, storeId: string, status?: 'AWAITING_DESTINATION' | 'AWAITING_SELLER_CONFIRM' | 'READY' | 'DONE') {
    await this.ownedStore(sellerId, storeId);
    const rows = await this.prisma.orderRefund.findMany({
      where: { storeId, ...(status ? { status } : { status: { not: 'CANCELLED' } }) },
      orderBy: { createdAt: 'asc' },
      include: {
        order: {
          select: {
            id: true,
            orderCode: true,
            recipientName: true,
            conversation: { select: { customer: { select: { fullName: true } } } },
          },
        },
      },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderCode: displayOrderCode(r.order),
      buyerName:
        r.order.conversation.customer.fullName || r.order.recipientName || '',
      amountToman: r.amountToman,
      reason: r.reason,
      note: r.note,
      status: r.status,
      destinationMasked: r.destinationMasked,
      destination: this.decryptIf(r.destinationEnc),
      destinationType: r.destinationType,
      holderName: r.holderName,
      bankName: r.bankName,
      paidRef: r.paidRef,
      createdAt: r.createdAt,
      waitingHours: Math.floor((now - r.createdAt.getTime()) / HOUR_MS),
      overdue: r.status === 'READY' && now - r.createdAt.getTime() > REFUND_OVERDUE_HOURS * HOUR_MS,
    }));
  }

  async summary(sellerId: string, storeId: string) {
    const rows = await this.list(sellerId, storeId, 'READY');
    const people = new Set(rows.map((r) => r.orderId)).size;
    const overdue = rows.filter((r) => r.overdue).length;
    const bankingText = rows
      .map((r) =>
        [r.buyerName, r.destination ?? r.destinationMasked ?? '', String(r.amountToman)].join('\t'),
      )
      .join('\n');
    return {
      readyCount: rows.length,
      readyAmountToman: rows.reduce((s, r) => s + r.amountToman, 0),
      people,
      overdue,
      bankingText,
    };
  }

  private decryptIf(enc: string | null): string | null {
    if (!enc) return null;
    try {
      return decryptSecret(enc, this.key());
    } catch {
      return null;
    }
  }

  private async ownedStore(sellerId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, sellerId },
      select: { id: true },
    });
    if (!store) throw new ForbiddenException(fa.salesAgent.orderNotFound);
  }

  private async ownedOrder(sellerId: string, storeId: string, orderId: string) {
    await this.ownedStore(sellerId, storeId);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
    });
    if (!order) throw new NotFoundException(fa.salesAgent.orderNotFound);
    return order;
  }

  private async ownedRefund(sellerId: string, storeId: string, refundId: string) {
    await this.ownedStore(sellerId, storeId);
    const refund = await this.prisma.orderRefund.findFirst({
      where: { id: refundId, storeId },
    });
    if (!refund) throw new NotFoundException(fa.order.refundNotFound);
    return refund;
  }

  private async customerId(conversationId: string): Promise<string> {
    const conv = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      select: { customerId: true },
    });
    return conv?.customerId ?? '';
  }
}
