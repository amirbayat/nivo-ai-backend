import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramApiClientService } from '../telegram/telegram-api-client.service';
import { fa } from '../../i18n/fa';

// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۳ — بر خلاف reviewFollowUpPrompt (فوری، در
// store.service.ts's requestReviewFollowUp)، این یک تماس واقعاً غیرفوری است: چند روز بعد از
// تایید سفارش، برای بررسی رضایت واقعی (بعد از این‌که خریدار زمان داشته محصول را ببیند/استفاده
// کند) — نه یک درخواست نظر دوم، پس آن فلگ (awaitingReview) را دست نمی‌زند
const FOLLOW_UP_DELAY_HOURS = 48;

// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۴.۲ — پیگیری سوم و مستقل،
// کاملاً جدا از ۴۸ساعته‌ی بالا (فیلد جدا mediaReviewFollowUpSentAt).
// به‌روزرسانی docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۳: قبلاً
// فقط یک پیام ثابت بود؛ حالا awaitingReview را هم دوباره فعال می‌کند تا خریدار بتواند همین‌جا
// در چت (متن/صوت/عکس/ویدیو، طبق conversation-engine.service.ts's doSubmitComment تعمیم‌یافته)
// یک نظر تازه ثبت کند، نه فقط با ارجاع به صفحه‌ی «سفارش‌هام»
const MEDIA_REVIEW_FOLLOW_UP_DELAY_HOURS = 7 * 24;

@Injectable()
export class PostPurchaseFollowUpService {
  private readonly logger = new Logger(PostPurchaseFollowUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramApi: TelegramApiClientService,
  ) {}

  async sendDueFollowUps(): Promise<void> {
    const threshold = new Date(
      Date.now() - FOLLOW_UP_DELAY_HOURS * 60 * 60 * 1000,
    );
    // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۲.۲ — سفارش‌های
    // عادی (hasFulfillmentDelay=false) دقیقاً مثل قبل از لحظه‌ی APPROVED شمرده می‌شوند (بدون
    // تغییر رفتار/زمان‌بندی تاییدشده‌ی موجود). سفارش‌های تحویل‌زمان‌بر هنوز آماده نشده‌اند تا
    // APPROVED بماند، پس لنگر زمان‌شان شدنِ SHIPPED/shippedAt است، نه APPROVED/updatedAt
    const dueOrders = await this.prisma.order.findMany({
      where: {
        satisfactionFollowUpSentAt: null,
        store: { postPurchaseFollowUpEnabled: true },
        OR: [
          {
            hasFulfillmentDelay: false,
            status: 'APPROVED',
            updatedAt: { lte: threshold },
          },
          {
            hasFulfillmentDelay: true,
            status: 'SHIPPED',
            shippedAt: { lte: threshold },
          },
        ],
      },
      include: { conversation: { include: { customer: true } } },
      take: 200,
    });

    for (const order of dueOrders) {
      const conversation = order.conversation;
      const text = fa.salesAgent.satisfactionFollowUpPrompt;
      const existingContext = (conversation.contextData ??
        {}) as Prisma.JsonObject;

      await this.prisma.$transaction([
        this.prisma.conversationEvent.create({
          data: {
            conversationId: conversation.id,
            type: 'AGENT_REPLY',
            payload: { text },
          },
        }),
        this.prisma.salesConversation.update({
          where: { id: conversation.id },
          data: {
            contextData: {
              ...existingContext,
              awaitingSatisfactionCheck: true,
            },
          },
        }),
        this.prisma.order.update({
          where: { id: order.id },
          data: { satisfactionFollowUpSentAt: new Date() },
        }),
      ]);

      if (
        conversation.customer.channel === 'TELEGRAM' &&
        conversation.customer.telegramChatId
      ) {
        await this.telegramApi.sendText(
          conversation.customer.telegramChatId,
          text,
        );
      }
    }

    if (dueOrders.length > 0) {
      this.logger.log(
        `Post-purchase follow-up sent for ${dueOrders.length} orders`,
      );
    }
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۴.۲ — عیناً الگوی
  // sendDueFollowUps بالا، فقط با آستانه‌ی ۷روزه و فیلد مستقل خودش؛ بدون تغییر contextData
  // (توضیح در کامنت ثابت بالا)
  async sendDueMediaReviewFollowUps(): Promise<void> {
    const threshold = new Date(
      Date.now() - MEDIA_REVIEW_FOLLOW_UP_DELAY_HOURS * 60 * 60 * 1000,
    );
    // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۲.۲ — همان دوشاخگی
    // sendDueFollowUps بالا (APPROVED/updatedAt برای عادی، SHIPPED/shippedAt برای تحویل‌زمان‌بر)
    const dueOrders = await this.prisma.order.findMany({
      where: {
        mediaReviewFollowUpSentAt: null,
        store: { postPurchaseFollowUpEnabled: true },
        OR: [
          {
            hasFulfillmentDelay: false,
            status: 'APPROVED',
            updatedAt: { lte: threshold },
          },
          {
            hasFulfillmentDelay: true,
            status: 'SHIPPED',
            shippedAt: { lte: threshold },
          },
        ],
      },
      include: { conversation: { include: { customer: true } } },
      take: 200,
    });

    for (const order of dueOrders) {
      const conversation = order.conversation;
      const text = fa.salesAgent.mediaReviewFollowUpPrompt;
      // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۳ — برخلاف
      // سندِ قبلی («پیام ثابت است، فلگی را دست نمی‌زند»)، کاربر خواست این لحظه هم بتواند
      // دوباره نظر بگیرد (نه فقط ارجاع به صفحه‌ی سفارش‌ها) — پس همان awaitingReview/
      // awaitingReviewProducty بازفعال می‌شود تا هرچه خریدار بعدش در چت بفرستد (متن/صوت/
      // عکس/ویدیو) مستقیم یک ProductComment تازه شود
      const items = order.items as { productId: string }[];
      const distinctProductIds = [...new Set(items.map((i) => i.productId))];
      const awaitingReviewProductId =
        distinctProductIds.length === 1 ? distinctProductIds[0] : null;
      const existingContext = (conversation.contextData ??
        {}) as Prisma.JsonObject;

      await this.prisma.$transaction([
        this.prisma.conversationEvent.create({
          data: {
            conversationId: conversation.id,
            type: 'AGENT_REPLY',
            payload: { text },
          },
        }),
        this.prisma.salesConversation.update({
          where: { id: conversation.id },
          data: {
            contextData: {
              ...existingContext,
              awaitingReview: true,
              awaitingReviewProductId,
            },
          },
        }),
        this.prisma.order.update({
          where: { id: order.id },
          data: { mediaReviewFollowUpSentAt: new Date() },
        }),
      ]);

      if (
        conversation.customer.channel === 'TELEGRAM' &&
        conversation.customer.telegramChatId
      ) {
        await this.telegramApi.sendText(
          conversation.customer.telegramChatId,
          text,
        );
      }
    }

    if (dueOrders.length > 0) {
      this.logger.log(
        `Media-review follow-up sent for ${dueOrders.length} orders`,
      );
    }
  }
}
