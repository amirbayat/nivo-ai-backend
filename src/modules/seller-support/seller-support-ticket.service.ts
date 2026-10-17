import { ForbiddenException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Store } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SmsService } from '../../sms/sms.service';
import { TicketsService } from '../tickets/tickets.service';
import { SellerBotApiClientService } from '../seller-bot/seller-bot-api-client.service';
import { fa } from '../../i18n/fa';
import type { TelegramCallbackQuery, TelegramMessage } from '../telegram/telegram.types';

// docs/PRD-seller-bot-support-agent.md بخش ۴/۵ — ارجاع به انسان + تلگرام ادمین + رله‌ی دوطرفه
export const TICKET_REF_REGEX = /\[ref:t_([0-9a-fA-F-]{36})\]/;
const LOG_MESSAGES = 10;
const SNIPPET_MAX = 600;

export interface EscalateInput {
  store: Store;
  summary: string;
  reason: string;
  lastMessage: string;
}

@Injectable()
export class SellerSupportTicketService implements OnModuleInit {
  private readonly logger = new Logger(SellerSupportTicketService.name);
  private readonly adminChatIds: Set<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tickets: TicketsService,
    private readonly api: SellerBotApiClientService,
    private readonly sms: SmsService,
  ) {
    this.adminChatIds = new Set(
      (this.config.get<string>('SELLER_SUPPORT_ADMIN_CHAT_IDS') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  onModuleInit(): void {
    this.tickets.onAdminReplied((e) => this.relayAdminReply(e.ticketId, e.body));
    this.tickets.onStatusChanged((e) => this.relayStatusChange(e.ticketId, e.status));
  }

  isAdminChat(chatId: string): boolean {
    return this.adminChatIds.has(chatId);
  }

  private snippet(text: string): string {
    return text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX)}…` : text;
  }

  // ── ارجاع (بخش ۴) ────────────────────────────────────────────────────────────

  async escalate(input: EscalateInput): Promise<{ created: boolean }> {
    const { store, summary, reason, lastMessage } = input;
    const { ticket, created } = await this.tickets.createFromSellerBot(store, {
      subject: summary.trim().slice(0, 120) || 'درخواست پشتیبانی',
      body: lastMessage,
      aiSummary: `${summary.trim()}\nدلیل ارجاع: ${reason.trim()}`,
    });
    // پیام‌هایی که از ارجاع به بعد رد و بدل می‌شوند به تیکت وصل‌اند؛ آخرین پیام فروشنده هم
    await this.prisma.sellerSupportMessage.updateMany({
      where: { storeId: store.id, ticketId: null, role: 'SELLER', body: lastMessage },
      data: { ticketId: ticket.id },
    });
    await this.notifyAdmins(
      ticket.id,
      store,
      created
        ? fa.sellerSupport.adminNewTicket(
            store.name,
            store.slug,
            ticket.aiSummary ?? summary,
            this.snippet(lastMessage),
            ticket.id,
          )
        : fa.sellerSupport.adminNewMessage(store.name, store.slug, this.snippet(lastMessage), ticket.id),
    );
    return { created };
  }

  private async notifyAdmins(ticketId: string, _store: Store, text: string): Promise<void> {
    const keyboard = {
      inline_keyboard: [
        [
          { text: fa.sellerSupport.adminReplyButton, callback_data: `sa:rp:${ticketId}` },
          { text: fa.sellerSupport.adminCloseButton, callback_data: `sa:cl:${ticketId}` },
        ],
        [{ text: fa.sellerSupport.adminLogButton, callback_data: `sa:lg:${ticketId}` }],
      ],
    };
    if (this.adminChatIds.size === 0) {
      this.logger.warn('SELLER_SUPPORT_ADMIN_CHAT_IDS not set — admin telegram notification skipped');
      return;
    }
    await Promise.all(
      [...this.adminChatIds].map((id) =>
        this.api.sendText(id, text, keyboard).catch((err) =>
          this.logger.error(`admin telegram notify failed (chat=${id}): ${err instanceof Error ? err.message : String(err)}`),
        ),
      ),
    );
  }

  // ── تلگرام ادمین (۵.۱) ──────────────────────────────────────────────────────

  async handleAdminMessage(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const text = message.text?.trim();
    if (!text) return;
    if (text === '/whoami') {
      await this.api.sendText(chatId, fa.sellerSupport.whoami(chatId));
      return;
    }
    const ticketId = message.reply_to_message?.text?.match(TICKET_REF_REGEX)?.[1];
    if (!ticketId) {
      await this.api.sendText(chatId, fa.sellerSupport.adminHelp);
      return;
    }
    try {
      await this.tickets.addAdminReply(ticketId, text);
      await this.api.sendText(chatId, fa.sellerSupport.adminReplySent);
    } catch (err) {
      this.logger.error(`admin reply failed: ${err instanceof Error ? err.message : String(err)}`);
      await this.api.sendText(chatId, fa.sellerBot.genericError);
    }
  }

  async handleAdminCallback(chatId: string, data: string): Promise<void> {
    const [, action, ticketId] = data.split(':');
    if (!ticketId) return;
    if (action === 'rp') {
      await this.api.sendForceReply(chatId, fa.sellerSupport.adminReplyPrompt(ticketId));
    } else if (action === 'cl') {
      await this.tickets.updateStatus(ticketId, 'CLOSED');
      await this.api.sendText(chatId, fa.sellerSupport.adminClosed);
    } else if (action === 'lg') {
      const ticket = await this.prisma.supportTicket.findUnique({
        where: { id: ticketId },
        select: { storeId: true },
      });
      if (!ticket?.storeId) return;
      const rows = (
        await this.prisma.sellerSupportMessage.findMany({
          where: { storeId: ticket.storeId },
          orderBy: { createdAt: 'desc' },
          take: LOG_MESSAGES,
        })
      ).reverse();
      const label = { SELLER: '🧑 فروشنده', ASSISTANT: '🤖 دستیار', ADMIN: '👤 پشتیبان' } as const;
      await this.api.sendText(
        chatId,
        rows.length
          ? rows.map((r) => `${label[r.role]}: ${this.snippet(r.body)}`).join('\n\n')
          : fa.sellerSupport.adminLogEmpty,
      );
    }
  }

  // ── رله به فروشنده (۵.۳) ────────────────────────────────────────────────────

  private async loadSellerTicket(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { store: { include: { seller: { select: { phone: true } } } } },
    });
    if (!ticket || ticket.channel !== 'SELLER_BOT' || !ticket.store) return null;
    return { ticket, store: ticket.store };
  }

  private async relayAdminReply(ticketId: string, body: string): Promise<void> {
    const found = await this.loadSellerTicket(ticketId);
    if (!found) return;
    const { store } = found;
    await this.prisma.sellerSupportMessage.create({
      data: { storeId: store.id, role: 'ADMIN', body, ticketId },
    });
    if (store.sellerBotChatId) {
      await this.api.sendText(store.sellerBotChatId, fa.sellerSupport.adminReplyToSeller(body, ticketId), {
        inline_keyboard: [[{ text: fa.sellerSupport.resolvedButton, callback_data: `ss:ok:${ticketId}` }]],
      });
      return;
    }
    // بات قطع است — فقط اطلاع‌رسانی کوتاه پیامکی (قالب در docs/SMS-templates.md)
    const phone = store.seller?.phone;
    if (phone) await this.sms.sendFreeText(phone, fa.sellerSupport.smsReplyReady);
    else this.logger.warn(`ticket ${ticketId}: seller has no bot and no phone — reply not delivered`);
  }

  private async relayStatusChange(ticketId: string, status: string): Promise<void> {
    if (status !== 'CLOSED' && status !== 'RESOLVED') return;
    const found = await this.loadSellerTicket(ticketId);
    if (!found?.store.sellerBotChatId) return;
    await this.api.sendText(found.store.sellerBotChatId, fa.sellerSupport.ticketClosedByAdmin);
  }

  // ── سمت فروشنده ─────────────────────────────────────────────────────────────

  // true = پیام به تیکت رفت؛ false = تیکت بسته/نامعتبر است و caller باید پیام را مثل سؤال تازه
  // به عامل بدهد
  async handleSellerTicketReply(store: Store, ticketId: string, text: string): Promise<boolean> {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.storeId !== store.id) return false;
    try {
      await this.tickets.addUserReply(store.sellerId, ticketId, text);
    } catch (err) {
      if (err instanceof ForbiddenException) return false;
      throw err;
    }
    await this.prisma.sellerSupportMessage.create({
      data: { storeId: store.id, role: 'SELLER', body: text, ticketId },
    });
    await this.notifyAdmins(
      ticketId,
      store,
      fa.sellerSupport.adminNewMessage(store.name, store.slug, this.snippet(text), ticketId),
    );
    await this.api.sendText(store.sellerBotChatId!, fa.sellerSupport.sellerReplyRecorded);
    return true;
  }

  async handleSellerResolved(store: Store, ticketId: string): Promise<void> {
    const ok = await this.tickets.resolveBySeller(store.id, ticketId);
    if (ok) await this.api.sendText(store.sellerBotChatId!, fa.sellerSupport.resolvedAck);
  }
}
