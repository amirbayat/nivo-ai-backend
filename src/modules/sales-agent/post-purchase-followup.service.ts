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
// کاملاً جدا از ۴۸ساعته‌ی بالا (فیلد جدا mediaReviewFollowUpSentAt)؛ فقط یک پیام ثابت است، نه
// چیزی که پیام آزاد بعدی مشتری را intercept کند (برخلاف awaitingReview/awaitingSatisfactionCheck
// — رسانه از پایپ‌لاین متن نمی‌تواند بیاید، پس چیزی برای parse کردن در پیام بعدی نیست)
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
    const dueOrders = await this.prisma.order.findMany({
      where: {
        status: 'APPROVED',
        satisfactionFollowUpSentAt: null,
        updatedAt: { lte: threshold },
        store: { postPurchaseFollowUpEnabled: true },
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
    const dueOrders = await this.prisma.order.findMany({
      where: {
        status: 'APPROVED',
        mediaReviewFollowUpSentAt: null,
        updatedAt: { lte: threshold },
        store: { postPurchaseFollowUpEnabled: true },
      },
      include: { conversation: { include: { customer: true } } },
      take: 200,
    });

    for (const order of dueOrders) {
      const conversation = order.conversation;
      const text = fa.salesAgent.mediaReviewFollowUpPrompt;

      await this.prisma.$transaction([
        this.prisma.conversationEvent.create({
          data: {
            conversationId: conversation.id,
            type: 'AGENT_REPLY',
            payload: { text },
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
