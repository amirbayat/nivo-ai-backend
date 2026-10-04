import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Store } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { StoreService } from '../store/store.service';
import { StoreCreditService } from '../store/store-credit.service';
import { SellerBotApiClientService } from './seller-bot-api-client.service';
import { normalizePhone } from '../../common/utils/normalize-phone';
import { fa } from '../../i18n/fa';
import type { CartItem } from '../sales-agent/sales-agent.types';
import type {
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from '../telegram/telegram.types';

// docs/PRD-seller-telegram-management-bot.md — فاز ۱: بات جدا برای مدیریت پنل فروشنده، با
// احراز هویت واقعی (اشتراک‌گذاری شماره‌ی تلگرام + همان OTP پیامکی پنل وب). عمداً مستقل از
// TelegramService/telegram.service.ts (بات مشتری‌محور) — هیچ خطی از آن فایل عوض نشده؛ اعلان
// handoff/رسید و پاسخ‌دهی فروشنده همچنان روی همان بات قبلی می‌ماند (فاز بعد، طبق بخش ۱ سند،
// تصمیم مهاجرت کامل گرفته می‌شود).
const OTP_PENDING_TTL_MS = 3 * 60 * 1000;
const STOCK_UPDATE_REF_REGEX = /کد محصول: ([0-9a-fA-F-]{36})/;
const REJECT_REASON_REF_REGEX = /کد سفارش رد: ([0-9a-fA-F-]{36})/;
const STOCK_SEARCH_MAX_RESULTS = 5;
const ORDERS_LIST_MAX = 5;

interface PendingOtp {
  phone: string;
  storeId: string;
  expiresAt: number;
}

@Injectable()
export class SellerBotService {
  private readonly logger = new Logger(SellerBotService.name);
  private readonly webhookSecret?: string;
  private readonly pendingOtp = new Map<string, PendingOtp>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly storeService: StoreService,
    private readonly storeCreditService: StoreCreditService,
    private readonly api: SellerBotApiClientService,
  ) {
    this.webhookSecret = this.config.get<string>('SELLER_BOT_WEBHOOK_SECRET');
  }

  verifySecret(secret: string | undefined): boolean {
    return !!this.webhookSecret && secret === this.webhookSecret;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    try {
      if (update.callback_query) {
        await this.handleCallback(update.callback_query);
        return;
      }
      const message = update.message;
      if (!message) return;

      if (message.contact) {
        await this.handleContact(message);
        return;
      }

      if (message.text) {
        const rejectOrderId = this.extractRef(message, REJECT_REASON_REF_REGEX);
        if (rejectOrderId) {
          await this.handleRejectReasonMessage(message, rejectOrderId);
          return;
        }
        const stockProductId = this.extractRef(message, STOCK_UPDATE_REF_REGEX);
        if (stockProductId) {
          await this.handleStockUpdateMessage(message, stockProductId);
          return;
        }
        await this.handleText(message);
        return;
      }
    } catch (err) {
      this.logger.error(
        `handleUpdate failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private extractRef(message: TelegramMessage, regex: RegExp): string | null {
    const promptText = message.reply_to_message?.text;
    if (!promptText) return null;
    const match = promptText.match(regex);
    return match ? match[1] : null;
  }

  private async getLinkedStore(chatId: string): Promise<Store | null> {
    return this.prisma.store.findUnique({ where: { sellerBotChatId: chatId } });
  }

  private async handleText(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const text = message.text!.trim();

    if (text === '/start' || text.startsWith('/start ')) {
      await this.handleStart(chatId);
      return;
    }
    if (text === '/logout') {
      await this.handleLogout(chatId);
      return;
    }
    if (text === '/help') {
      await this.api.sendText(chatId, fa.sellerBot.help);
      return;
    }
    if (text === '/orders') {
      await this.handleOrders(chatId);
      return;
    }
    if (text === '/stock' || text.startsWith('/stock ')) {
      await this.handleStockSearch(chatId, text.slice('/stock'.length).trim());
      return;
    }
    if (text === '/credit') {
      await this.handleCredit(chatId);
      return;
    }

    const pending = this.pendingOtp.get(chatId);
    if (pending) {
      await this.handleOtpAttempt(chatId, pending, text);
      return;
    }

    await this.api.sendText(chatId, fa.sellerBot.unknownCommand);
  }

  private async handleStart(chatId: string): Promise<void> {
    const store = await this.getLinkedStore(chatId);
    if (store) {
      await this.api.sendText(chatId, fa.sellerBot.alreadyLinked(store.name));
      return;
    }
    await this.api.sendText(chatId, fa.sellerBot.shareContactPrompt, {
      keyboard: [
        [{ text: fa.sellerBot.shareContactButton, request_contact: true }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
  }

  private async handleContact(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const phone = normalizePhone(message.contact!.phone_number);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    const store = user
      ? await this.prisma.store.findFirst({ where: { sellerId: user.id } })
      : null;
    if (!user || !store) {
      await this.api.sendText(chatId, fa.sellerBot.contactPhoneNotFound);
      return;
    }

    await this.authService.sendOtp(phone);
    this.pendingOtp.set(chatId, {
      phone,
      storeId: store.id,
      expiresAt: Date.now() + OTP_PENDING_TTL_MS,
    });
    await this.api.sendForceReply(chatId, fa.sellerBot.otpSent);
  }

  private async handleOtpAttempt(
    chatId: string,
    pending: PendingOtp,
    code: string,
  ): Promise<void> {
    if (pending.expiresAt < Date.now()) {
      this.pendingOtp.delete(chatId);
      await this.api.sendText(chatId, fa.sellerBot.otpInvalid);
      return;
    }
    const ok = await this.authService.verifyOtpCodeOnly(pending.phone, code);
    if (!ok) {
      await this.api.sendText(chatId, fa.sellerBot.otpInvalid);
      return;
    }
    this.pendingOtp.delete(chatId);
    const store = await this.prisma.store.update({
      where: { id: pending.storeId },
      data: { sellerBotChatId: chatId, sellerBotLinkedAt: new Date() },
    });
    await this.api.removeReplyKeyboard(chatId, fa.sellerBot.linked(store.name));
  }

  private async handleLogout(chatId: string): Promise<void> {
    const store = await this.getLinkedStore(chatId);
    if (!store) {
      await this.api.sendText(chatId, fa.sellerBot.logoutNotLinked);
      return;
    }
    await this.prisma.store.update({
      where: { id: store.id },
      data: { sellerBotChatId: null, sellerBotLinkedAt: null },
    });
    await this.api.sendText(chatId, fa.sellerBot.logoutSuccess);
  }

  private async requireLinkedStore(chatId: string): Promise<Store | null> {
    const store = await this.getLinkedStore(chatId);
    if (!store) {
      await this.api.sendText(chatId, fa.sellerBot.notLinked);
      return null;
    }
    return store;
  }

  private async handleOrders(chatId: string): Promise<void> {
    const store = await this.requireLinkedStore(chatId);
    if (!store) return;

    const orders = (
      await this.storeService.listOrders(store.sellerId, store.id)
    ).slice(0, ORDERS_LIST_MAX);
    if (orders.length === 0) {
      await this.api.sendText(chatId, fa.sellerBot.ordersEmpty);
      return;
    }

    const lines = orders.map((o) => {
      const items = o.items as CartItem[];
      const itemsSummary = items.map((i) => i.name).join('، ');
      return fa.sellerBot.orderLine(
        itemsSummary,
        o.totalAmount,
        fa.sellerBot.orderStatusLabel[o.status] ?? o.status,
        o.createdAt,
      );
    });
    await this.api.sendText(
      chatId,
      `${fa.sellerBot.ordersHeader}\n\n${lines.join('\n')}`,
    );

    for (const order of orders) {
      if (order.status !== 'RECEIPT_SUBMITTED') continue;
      const items = order.items as CartItem[];
      const itemsSummary = items.map((i) => i.name).join('، ');
      await this.api.sendText(
        chatId,
        fa.sellerBot.orderNeedsDecision(itemsSummary, order.totalAmount),
        {
          inline_keyboard: [
            [
              {
                text: fa.sellerBot.orderApproveButton,
                callback_data: `sbap:${order.id}`,
              },
              {
                text: fa.sellerBot.orderRejectButton,
                callback_data: `sbrj:${order.id}`,
              },
            ],
          ],
        },
      );
    }
  }

  private async handleCallback(cq: TelegramCallbackQuery): Promise<void> {
    const chatId = cq.message ? String(cq.message.chat.id) : String(cq.from.id);
    await this.api.answerCallbackQuery(cq.id);
    const data = cq.data ?? '';

    if (data.startsWith('sbap:') || data.startsWith('sbrj:')) {
      await this.handleOrderDecision(chatId, data);
      return;
    }
    if (data.startsWith('sbst:')) {
      await this.handleStockSelect(chatId, data.slice('sbst:'.length));
      return;
    }
  }

  private async handleOrderDecision(
    chatId: string,
    data: string,
  ): Promise<void> {
    const store = await this.getLinkedStore(chatId);
    if (!store) return;
    const approve = data.startsWith('sbap:');
    const orderId = data.slice(5);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order || order.storeId !== store.id) return;

    if (approve) {
      await this.storeService.approveOrder(store.sellerId, store.id, orderId);
      await this.api.sendText(chatId, fa.sellerBot.orderApproved);
    } else {
      await this.api.sendForceReply(
        chatId,
        fa.sellerBot.orderRejectReasonPrompt(orderId),
      );
    }
  }

  private async handleRejectReasonMessage(
    message: TelegramMessage,
    orderId: string,
  ): Promise<void> {
    const chatId = String(message.chat.id);
    const store = await this.getLinkedStore(chatId);
    if (!store) return;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order || order.storeId !== store.id) return;

    const text = message.text?.trim();
    const reason =
      !text || text === fa.sellerBot.orderRejectReasonSkipKeyword
        ? undefined
        : text;
    await this.storeService.rejectOrder(
      store.sellerId,
      store.id,
      orderId,
      reason,
    );
    await this.api.sendText(chatId, fa.sellerBot.orderRejected);
  }

  private async handleStockSearch(
    chatId: string,
    query: string,
  ): Promise<void> {
    const store = await this.requireLinkedStore(chatId);
    if (!store) return;
    if (!query) {
      await this.api.sendText(chatId, fa.sellerBot.stockUsage);
      return;
    }

    const products = await this.storeService.listProducts(
      store.sellerId,
      store.id,
    );
    const q = query.toLowerCase();
    const matches = products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.code && p.code.toLowerCase().includes(q)),
      )
      .slice(0, STOCK_SEARCH_MAX_RESULTS);

    if (matches.length === 0) {
      await this.api.sendText(chatId, fa.sellerBot.stockSearchEmpty);
      return;
    }

    await this.api.sendText(chatId, fa.sellerBot.stockSearchHeader, {
      inline_keyboard: matches.map((p) => [
        {
          text: `${p.name} (موجودی: ${p.stock})`,
          callback_data: `sbst:${p.id}`,
        },
      ]),
    });
  }

  private async handleStockSelect(
    chatId: string,
    productId: string,
  ): Promise<void> {
    const store = await this.getLinkedStore(chatId);
    if (!store) return;
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.storeId !== store.id) return;

    await this.api.sendForceReply(
      chatId,
      fa.sellerBot.stockPrompt(product.name, product.stock, product.id),
    );
  }

  private async handleStockUpdateMessage(
    message: TelegramMessage,
    productId: string,
  ): Promise<void> {
    const chatId = String(message.chat.id);
    const store = await this.getLinkedStore(chatId);
    if (!store) return;
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.storeId !== store.id) return;

    const text = message.text?.trim() ?? '';
    const stock = Number(text);
    if (!/^\d+$/.test(text) || !Number.isInteger(stock)) {
      await this.api.sendText(chatId, fa.sellerBot.stockInvalidNumber);
      return;
    }

    await this.storeService.updateProduct(store.sellerId, store.id, productId, {
      stock,
    });
    await this.api.sendText(
      chatId,
      fa.sellerBot.stockUpdated(product.name, stock),
    );
  }

  private async handleCredit(chatId: string): Promise<void> {
    const store = await this.requireLinkedStore(chatId);
    if (!store) return;
    const status = await this.storeCreditService.getStatus(
      store.sellerId,
      store.id,
    );
    await this.api.sendText(
      chatId,
      fa.sellerBot.creditBalance(status.balanceToman),
    );
  }
}
