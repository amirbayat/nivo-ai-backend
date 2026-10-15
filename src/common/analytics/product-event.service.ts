import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// docs/PRD-seller-panel-simplification.md §4.1/§4.10 — تنها در ثبت رویداد محصول. fire-and-forget:
// خطای دیتابیس هیچ‌وقت مسیر اصلی را نمی‌شکند.
export type ProductEventName =
  | 'chat_first_token_ms'
  | 'price_guard_triggered'
  | 'store_created'
  | 'product_draft_created'
  | 'product_ai_draft'
  | 'product_published'
  | 'payment_method_added'
  | 'shop_link_shared'
  | 'test_chat_started'
  | 'seller_bot_linked'
  | 'product_link_shared'
  | 'product_duplicated';

export interface ProductEventContext {
  storeId?: string | null;
  userId?: string | null;
  conversationId?: string | null;
}

@Injectable()
export class ProductEventService {
  private readonly logger = new Logger(ProductEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  log(name: ProductEventName, ctx: ProductEventContext = {}, props?: Record<string, unknown>): void {
    try {
      void Promise.resolve(
        this.prisma.productEvent.create({
          data: {
            name,
            storeId: ctx.storeId ?? null,
            userId: ctx.userId ?? null,
            conversationId: ctx.conversationId ?? null,
            props: props ? (props as Prisma.InputJsonValue) : undefined,
          },
        }),
      ).catch((err) => this.logger.warn(`product event ${name} write failed: ${(err as Error).message}`));
    } catch (err) {
      this.logger.warn(`product event ${name} write failed: ${(err as Error).message}`);
    }
  }

  countSince(name: ProductEventName, storeId: string, since: Date): Promise<number> {
    return this.prisma.productEvent.count({
      where: { name, storeId, createdAt: { gte: since } },
    });
  }
}
