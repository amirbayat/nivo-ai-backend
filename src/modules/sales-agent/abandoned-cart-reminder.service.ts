import { Injectable, Logger } from '@nestjs/common';
import type { DiscountKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramApiClientService } from '../telegram/telegram-api-client.service';
import { fa } from '../../i18n/fa';
import type { CartItem } from './sales-agent.types';

// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۴ — اگر مکالمه به سبد رسید ولی رسید هیچ‌وقت
// نیامد، بعد از این‌قدر ساعت یک یادآوری ملایم یک‌باره
const ABANDONED_CART_THRESHOLD_HOURS = 3;

// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۲ — یادآوری دوم، وسط بازه‌ی پیشنهادی
// «۱۲-۲۴ ساعت» سند؛ فاصله از یادآوری اول حساب می‌شود، نه از updatedAt مکالمه
const SECOND_REMINDER_THRESHOLD_HOURS = 18;

function firstCartItemName(contextData: Prisma.JsonValue): string | undefined {
  const cart = (contextData as { cart?: CartItem[] } | null)?.cart;
  return cart && cart.length > 0 ? cart[0].name : undefined;
}

function discountLabel(kind: DiscountKind, value: number): string {
  return kind === 'PERCENT' ? `${value}٪` : `${value} تومانی`;
}

@Injectable()
export class AbandonedCartReminderService {
  private readonly logger = new Logger(AbandonedCartReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramApi: TelegramApiClientService,
  ) {}

  async sendDueReminders(): Promise<void> {
    const threshold = new Date(
      Date.now() - ABANDONED_CART_THRESHOLD_HOURS * 60 * 60 * 1000,
    );
    const dueConversations = await this.prisma.salesConversation.findMany({
      where: {
        currentState: { in: ['CART_REVIEW', 'AWAITING_PAYMENT'] },
        archivedAt: null,
        isMutedForHuman: false,
        abandonedCartReminderSentAt: null,
        updatedAt: { lte: threshold },
        store: { abandonedCartReminderEnabled: true },
      },
      include: { customer: true },
      take: 200,
    });

    for (const conversation of dueConversations) {
      const text = fa.salesAgent.abandonedCartReminder(
        firstCartItemName(conversation.contextData),
      );
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
          data: { abandonedCartReminderSentAt: new Date() },
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

    if (dueConversations.length > 0) {
      this.logger.log(
        `Abandoned cart reminder sent for ${dueConversations.length} conversations`,
      );
    }
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۲ — یادآوری دوم، فقط وقتی فروشگاه از
  // قبل یک StoreDiscountCode معتبر دارد؛ اگر نداشت، این مکالمه بی‌صدا رد می‌شود (نه fallback به
  // متن بدون تخفیف) و secondAbandonedCartReminderSentAt هم ست نمی‌شود — تا اگر فروشنده بعداً یک
  // کد فعال ساخت، همان مکالمه در اجرای بعدی cron دوباره بررسی شود
  async sendDueSecondReminders(): Promise<void> {
    const threshold = new Date(
      Date.now() - SECOND_REMINDER_THRESHOLD_HOURS * 60 * 60 * 1000,
    );
    const dueConversations = await this.prisma.salesConversation.findMany({
      where: {
        currentState: { in: ['CART_REVIEW', 'AWAITING_PAYMENT'] },
        archivedAt: null,
        isMutedForHuman: false,
        abandonedCartReminderSentAt: { not: null, lte: threshold },
        secondAbandonedCartReminderSentAt: null,
        store: { abandonedCartReminderEnabled: true },
      },
      include: { customer: true },
      take: 200,
    });
    if (dueConversations.length === 0) return;

    const storeIds = Array.from(
      new Set(dueConversations.map((c) => c.storeId)),
    );
    const activeDiscounts = await this.prisma.storeDiscountCode.findMany({
      where: {
        storeId: { in: storeIds },
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    const discountByStore = new Map<string, (typeof activeDiscounts)[number]>();
    for (const d of activeDiscounts) {
      if (d.maxRedemptions != null && d.redemptionCount >= d.maxRedemptions) {
        continue;
      }
      if (!discountByStore.has(d.storeId)) discountByStore.set(d.storeId, d);
    }

    let sentCount = 0;
    for (const conversation of dueConversations) {
      const discount = discountByStore.get(conversation.storeId);
      if (!discount) continue;

      const text = fa.salesAgent.abandonedCartReminderWithDiscount(
        discount.code,
        discountLabel(discount.kind, discount.value),
        firstCartItemName(conversation.contextData),
      );
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
          data: { secondAbandonedCartReminderSentAt: new Date() },
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
      sentCount++;
    }

    if (sentCount > 0) {
      this.logger.log(
        `Second abandoned cart reminder sent for ${sentCount} conversations`,
      );
    }
  }
}
