import { BUYER_VISIBLE } from '../store/product-visibility';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { fa } from '../../i18n/fa';

export type RestockLine = {
  productId: string;
  variantId: string | null;
  previous: number;
  next: number;
};

@Injectable()
export class StockAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async subscribe(input: {
    storeId: string;
    productId: string;
    variantId?: string;
    customerId: string;
    conversationId: string;
  }): Promise<{ status: 'subscribed' | 'needs_phone' | 'in_stock' }> {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, storeId: input.storeId, ...BUYER_VISIBLE },
      select: { id: true, stock: true, trackStock: true },
    });
    if (!product) throw new NotFoundException(fa.store.notFound);
    // SP-3 — «همیشه موجود» هیچ‌وقت ناموجود نمی‌شود، پس اشتراک «موجود شد» معنی ندارد
    if (product.trackStock === false) return { status: 'in_stock' };
    let stock = product.stock;
    if (input.variantId) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: input.variantId, productId: product.id },
        select: { stock: true },
      });
      if (!variant) throw new NotFoundException(fa.store.notFound);
      stock = variant.stock;
    }
    if (stock > 0) return { status: 'in_stock' };
    const customer = await this.prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { phone: true, phoneVerifiedAt: true },
    });
    if (!customer?.phoneVerifiedAt || !customer.phone) {
      return { status: 'needs_phone' };
    }
    const variantId = input.variantId ?? null;
    const existing = await this.prisma.productStockAlert.findFirst({
      where: {
        productId: product.id,
        variantId,
        customerId: input.customerId,
        notifiedAt: null,
      },
    });
    if (!existing) {
      try {
        await this.prisma.productStockAlert.create({
          data: {
            storeId: input.storeId,
            productId: product.id,
            variantId,
            customerId: input.customerId,
            conversationId: input.conversationId,
            phone: customer.phone,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          return { status: 'subscribed' };
        }
        throw err;
      }
    }
    return { status: 'subscribed' };
  }

  async notifyRestocked(lines: RestockLine[]): Promise<void> {
    const risen = lines.filter((line) => line.previous <= 0 && line.next > 0);
    for (const line of risen) {
      const alerts = await this.prisma.productStockAlert.findMany({
        where: {
          productId: line.productId,
          variantId: line.variantId,
          notifiedAt: null,
          // محصول پنهان/پیش‌نویس به خریدار «موجود شد» نمی‌دهد (لینکش باز نمی‌شود)
          product: { status: 'ACTIVE' },
        },
        orderBy: { createdAt: 'asc' },
        include: {
          product: {
            select: { name: true, store: { select: { slug: true } } },
          },
        },
      });
      const base = (process.env.APP_URL ?? '').replace(/\/$/, '');
      // TODO(product): texting every waiter on a popular restock gets expensive.
      // The first 200 get SMS and chat. Everyone after that only gets the chat message.
      const RESTOCK_SMS_CAP = 200;
      for (let i = 0; i < alerts.length; i++) {
        const alert = alerts[i];
        const productUrl = base
          ? `${base}/shop/${alert.product.store.slug}?product=${alert.productId}`
          : '';
        await this.notifications.notifyBuyer({
          to: { customerId: alert.customerId },
          template: 'BACK_IN_STOCK',
          entityId: alert.id,
          channels: i < RESTOCK_SMS_CAP ? undefined : ['CHAT'],
          data: {
            orderId: alert.id,
            productName: alert.product.name,
            conversationId: alert.conversationId ?? undefined,
            productUrl,
          },
        });
        await this.prisma.productStockAlert.update({
          where: { id: alert.id },
          data: { notifiedAt: new Date() },
        });
      }
    }
  }

  async openCountsByProduct(storeId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.productStockAlert.groupBy({
      by: ['productId'],
      where: { storeId, notifiedAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.productId, row._count._all]));
  }

  async collectRestoreLines(
    tx: Prisma.TransactionClient,
    items: Prisma.JsonValue,
  ): Promise<RestockLine[]> {
    const lines: RestockLine[] = [];
    for (const item of items as {
      productId?: string;
      variantId?: string;
      qty?: number;
    }[]) {
      if (!item.productId || !(item.qty && item.qty > 0)) continue;
      if (item.variantId) {
        const row = await tx.productVariant.findFirst({
          where: { id: item.variantId, productId: item.productId },
          select: { stock: true, product: { select: { trackStock: true } } },
        });
        if (!row || row.product.trackStock === false) continue;
        lines.push({
          productId: item.productId,
          variantId: item.variantId,
          previous: row.stock,
          next: row.stock + item.qty,
        });
      } else {
        const row = await tx.product.findUnique({
          where: { id: item.productId },
          select: { stock: true, trackStock: true },
        });
        if (!row || row.trackStock === false) continue;
        lines.push({
          productId: item.productId,
          variantId: null,
          previous: row.stock,
          next: row.stock + item.qty,
        });
      }
    }
    return lines;
  }
}
