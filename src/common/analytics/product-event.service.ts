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
  | 'product_duplicated'
  // docs/PRD-buyer-chat-redesign.md §10 — رویدادهای صفحه‌ی خریدار (از POST v2/chat/:id/ui-events)
  | 'shop_view'
  | 'product_sheet_opened'
  | 'cart_add'
  | 'ask_from_products'
  | 'checkout_sheet_opened'
  | 'about_opened'
  | 'menu_item'
  // docs/PRD-nivo-lead-shop-seller-signup.md §5.9 — فانل فروشگاه لید (بدون PII)
  | 'lead_view'
  | 'lead_chip_how'
  | 'lead_chip_price'
  | 'lead_chip_demo'
  | 'lead_chip_signup'
  | 'lead_signup_open'
  | 'lead_phone_submit'
  | 'lead_otp_sent'
  | 'lead_otp_fail'
  | 'lead_verified'
  | 'lead_go_onboarding';

// فهرست سفید نام‌های مجاز ui-events (B5)
export const SHOP_UI_EVENT_NAMES = [
  'shop_view',
  'product_sheet_opened',
  'cart_add',
  'ask_from_products',
  'checkout_sheet_opened',
  'about_opened',
  'menu_item',
  'lead_view',
  'lead_chip_how',
  'lead_chip_price',
  'lead_chip_demo',
  'lead_chip_signup',
  'lead_signup_open',
  'lead_phone_submit',
  'lead_otp_sent',
  'lead_otp_fail',
  'lead_verified',
  'lead_go_onboarding',
] as const;
export type ShopUiEventName = (typeof SHOP_UI_EVENT_NAMES)[number];

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
