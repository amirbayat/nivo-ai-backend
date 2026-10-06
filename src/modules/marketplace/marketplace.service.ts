import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePhone } from '../../common/utils/normalize-phone';
import type { CartItem } from '../sales-agent/sales-agent.types';

// فیلد Order.recipientPhone آزاد تایپ شده (conversation-engine.service.ts's doCollectAddress)
// و normalizePhone صدا زده نمی‌شود — یعنی داده‌ی موجود می‌تواند «09xxxxxxxxx»، «+989xxxxxxxxx»
// یا حتی بدون پیشوند «9xxxxxxxxx» ذخیره شده باشد. برای درست پیداکردن سفارش‌ها باید هر سه حالت
// را جست‌وجو کرد، نه فقط یک فرمت کانونیک.
function phoneVariants(rawPhone: string): string[] {
  const bare = normalizePhone(rawPhone).replace(/^0/, '');
  return [`0${bare}`, `+98${bare}`, bare];
}

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveStores() {
    const stores = await this.prisma.store.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        logoImageKey: true,
      },
      orderBy: { name: 'asc' },
    });
    return { stores };
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۴.۲ — «سفارش‌های من» دیگر
  // توکن ۳۰-دقیقه‌ای مخصوص خودش صادر نمی‌کند؛ خریدار از همان /auth/send-otp و /auth/verify-otp
  // عمومی (AuthController) لاگین می‌کند و یک User واقعی + رفرش‌توکن ۳۰روزه می‌گیرد — این
  // endpoint حالا فقط پشت JwtGuard همان توکن را می‌خواند (phone از JwtPayload)
  async getMyOrders(buyerPhone: string) {
    const variants = phoneVariants(buyerPhone);

    const orders = await this.prisma.order.findMany({
      where: { recipientPhone: { in: variants } },
      include: { store: { select: { id: true, slug: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const byStore = new Map<
      string,
      {
        storeId: string;
        storeName: string;
        storeSlug: string;
        orders: {
          id: string;
          createdAt: Date;
          items: CartItem[];
          totalAmount: number;
          status: string;
        }[];
      }
    >();
    for (const order of orders) {
      const group = byStore.get(order.storeId) ?? {
        storeId: order.store.id,
        storeName: order.store.name,
        storeSlug: order.store.slug,
        orders: [],
      };
      group.orders.push({
        id: order.id,
        createdAt: order.createdAt,
        items: order.items as unknown as CartItem[],
        totalAmount: order.totalAmount,
        status: order.status,
      });
      byStore.set(order.storeId, group);
    }

    return { stores: Array.from(byStore.values()) };
  }
}
