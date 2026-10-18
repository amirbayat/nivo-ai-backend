import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SellerBotApiClientService } from '../seller-bot/seller-bot-api-client.service';
import { StoreCreditDeductionService } from '../store-credit-engine/store-credit-deduction.service';
import { fa } from '../../i18n/fa';

// docs/PRD-seller-conversations-inbox.md §۴.۵
export const SELLER_REPLY_REMINDER_MINUTES = 15;
export const AUTO_BACK_TO_BOT_HOURS = 12;
// گفتگوهایی که مشتری‌شان خیلی وقت پیش پیام داده یادآوری نمی‌گیرند (جلوگیری از اسپم بعد از دیپلوی)
const REMINDER_MAX_AGE_HOURS = 6;
const REMINDER_TEMPLATE = 'SELLER_REPLY_REMINDER';

@Injectable()
export class SellerConversationFollowUpService {
  private readonly logger = new Logger(SellerConversationFollowUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerBotApi: SellerBotApiClientService,
    private readonly config: ConfigService,
    private readonly creditDeduction: StoreCreditDeductionService,
  ) {}

  // یک‌بار به‌ازای هر پیام مشتری (dedupe با NotificationLog.entityId = <conv>:<lastCustomerMessageAt ms>)
  async sendDueSellerReplyReminders(now: Date = new Date()): Promise<number> {
    const dueBefore = new Date(
      now.getTime() - SELLER_REPLY_REMINDER_MINUTES * 60_000,
    );
    const notOlderThan = new Date(
      now.getTime() - REMINDER_MAX_AGE_HOURS * 3_600_000,
    );
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        lastCustomerMessageAt: Date;
        customerLabel: string | null;
        sellerBotChatId: string;
      }[]
    >`
      SELECT c."id", c."lastCustomerMessageAt",
             COALESCE(cu."phone", cu."fullName") AS "customerLabel",
             s."sellerBotChatId"
      FROM "sales_conversations" c
      JOIN "stores" s ON s."id" = c."storeId"
      JOIN "customers" cu ON cu."id" = c."customerId"
      WHERE c."isMutedForHuman" = true
        AND c."humanTakenOverAt" IS NOT NULL
        AND c."isTest" = false
        AND s."sellerBotChatId" IS NOT NULL
        AND c."lastCustomerMessageAt" IS NOT NULL
        AND c."lastCustomerMessageAt" >= c."lastMessageAt"
        AND c."lastCustomerMessageAt" <= ${dueBefore}
        AND c."lastCustomerMessageAt" >= ${notOlderThan}
      LIMIT 200`;
    let sent = 0;
    const base = (this.config.get<string>('APP_URL') ?? '').replace(/\/$/, '');
    for (const row of rows) {
      const entityId = `${row.id}:${row.lastCustomerMessageAt.getTime()}`;
      const already = await this.prisma.notificationLog.findFirst({
        where: { template: REMINDER_TEMPLATE, entityId },
        select: { id: true },
      });
      if (already) continue;
      const url = base ? `${base}/seller/panel/chats/${row.id}` : '';
      let status = 'SENT';
      let error: string | undefined;
      try {
        await this.sellerBotApi.sendText(
          row.sellerBotChatId,
          fa.sellerConversations.replyReminder(row.customerLabel ?? 'مشتری'),
          url
            ? {
                inline_keyboard: [
                  [{ text: fa.sellerConversations.replyReminderButton, url }],
                ],
              }
            : undefined,
        );
        sent++;
      } catch (err) {
        status = 'FAILED';
        error = String(err).slice(0, 500);
        this.logger.warn(
          `seller reply reminder failed (conversation=${row.id}): ${error}`,
        );
      }
      await this.prisma.notificationLog.create({
        data: {
          template: REMINDER_TEMPLATE,
          channel: 'SELLER_BOT',
          to: row.sellerBotChatId,
          status,
          entityId,
          error,
        },
      });
    }
    return sent;
  }

  // دست‌گرفته‌شده‌ی ۱۲ ساعته‌ی بی‌جواب ← برگشت خودکار به بات؛ شکایت/handoff (HANDOFF_HUMAN)
  // و سفارش منتظر تأیید فروشنده مستثنی‌اند (بات نباید جوابشان را بدهد)
  async autoReturnStaleConversations(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - AUTO_BACK_TO_BOT_HOURS * 3_600_000);
    const rows = await this.prisma.$queryRaw<{ id: string; storeId: string }[]>`
      SELECT c."id", c."storeId"
      FROM "sales_conversations" c
      WHERE c."isMutedForHuman" = true
        AND c."humanTakenOverAt" IS NOT NULL
        AND c."isTest" = false
        AND c."currentState" NOT IN ('HANDOFF_HUMAN', 'AWAITING_SELLER_APPROVAL')
        AND c."archivedAt" IS NULL
        AND c."lastCustomerMessageAt" IS NOT NULL
        -- مشتری بعد از آخرین پیام فروشنده (یا زمان دست‌گرفتن) پیام داده
        AND c."lastCustomerMessageAt" > COALESCE(
          (SELECT MAX(e."createdAt") FROM "conversation_events" e
            WHERE e."conversationId" = c."id" AND e."type" = 'SELLER_MESSAGE'),
          c."humanTakenOverAt")
        -- و از آخرین پیام فروشنده (یا دست‌گرفتن) ۱۲ ساعت گذشته
        AND COALESCE(
          (SELECT MAX(e."createdAt") FROM "conversation_events" e
            WHERE e."conversationId" = c."id" AND e."type" = 'SELLER_MESSAGE'),
          c."humanTakenOverAt") <= ${cutoff}
      LIMIT 200`;
    // مثل unmuteConversation دستی: اگر فروشگاه حالا اعتبار دارد مکالمات BLOCKED دوباره PAID شوند،
    // وگرنه بات بلافاصله دوباره handoff می‌داد. currentState عمداً دست نمی‌خورد (HANDOFF_HUMAN از
    // قبل مستثنی است؛ بقیه‌ی حالت‌ها مثل CART_REVIEW واقعی‌اند و نباید به BROWSING بپرند)
    for (const storeId of new Set(rows.map((r) => r.storeId))) {
      await this.creditDeduction
        .reevaluateBlockedConversations(storeId)
        .catch((err) =>
          this.logger.error(
            `reevaluateBlockedConversations failed (store=${storeId})`,
            err,
          ),
        );
    }
    for (const { id } of rows) {
      await this.prisma.$transaction([
        this.prisma.salesConversation.update({
          where: { id },
          data: {
            isMutedForHuman: false,
            humanTakenOverAt: null,
            clarifyAttempts: 0,
          },
        }),
        this.prisma.conversationEvent.create({
          data: {
            conversationId: id,
            type: 'SYSTEM',
            payload: { kind: 'AUTO_BACK_TO_BOT' },
          },
        }),
      ]);
    }
    return rows.length;
  }
}
