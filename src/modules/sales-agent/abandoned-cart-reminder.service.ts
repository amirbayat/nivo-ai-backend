import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramApiClientService } from '../telegram/telegram-api-client.service';
import { fa } from '../../i18n/fa';

// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۴ — اگر مکالمه به سبد رسید ولی رسید هیچ‌وقت
// نیامد، بعد از این‌قدر ساعت یک یادآوری ملایم یک‌باره
const ABANDONED_CART_THRESHOLD_HOURS = 3;

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
      },
      include: { customer: true },
      take: 200,
    });

    for (const conversation of dueConversations) {
      const text = fa.salesAgent.abandonedCartReminder;
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
}
