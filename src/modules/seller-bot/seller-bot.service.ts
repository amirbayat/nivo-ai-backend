import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { ProductEventService } from '../../common/analytics/product-event.service';
import { safeEqual } from '../../common/utils/safe-equal.util';
import type { Store } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { StoreService } from '../store/store.service';
import { StoreCreditService } from '../store/store-credit.service';
import { RefundService } from '../order-lifecycle/refund.service';
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
// TelegramService/telegram.service.ts (بات مشتری‌محور) — هیچ خطی از آن فایل عوض نشده. فاز ۲
// (بخش ۸ سند): اعلان handoff/رسید حالا هم این‌جا پوش می‌شود (از conversation-engine.service.ts،
// نه دیگر بات قدیم)؛ ایمپورت گروهی محصول با سند/صوت هنوز فقط روی بات قدیم مانده.
const OTP_PENDING_TTL_MS = 3 * 60 * 1000;
const CONNECT_TOKEN_TTL_MS = 15 * 60 * 1000;
const STOCK_UPDATE_REF_REGEX = /کد محصول: ([0-9a-fA-F-]{36})/;
const REJECT_REASON_REF_REGEX = /کد سفارش رد: ([0-9a-fA-F-]{36})(?: پول:(0|1))?/;
const CONVERSATION_REPLY_REF_REGEX = /کد مکالمه: ([0-9a-fA-F-]{36})/;
const STOCK_SEARCH_MAX_RESULTS = 5;
const ORDERS_LIST_MAX = 5;
const ATTENTION_LIST_MAX = 5;

// docs/PRD-seller-telegram-management-bot.md — فیدبک کاربر: همه‌ی بخش‌ها باید دکمه‌ی
// جای‌کیبرد (reply keyboard) داشته باشند، نه فقط دستور متنی. این کیبرد دائمی است (نه
// one_time) — یک‌بار فرستاده می‌شود و تا force_reply/inline keyboard بعدی زیر صفحه می‌ماند؛
// بعد از هر اکشن تمام‌شده دوباره با پیام پایانی فرستاده می‌شود تا همیشه در دسترس باشد
const MAIN_MENU_KEYBOARD = {
  keyboard: [
    [{ text: fa.sellerBot.menuTodayButton }],
    [
      { text: fa.sellerBot.menuOrdersButton },
      { text: fa.sellerBot.menuAttentionButton },
    ],
    [
      { text: fa.sellerBot.menuStockButton },
      { text: fa.sellerBot.menuCreditButton },
    ],
    [{ text: fa.sellerBot.menuLogoutButton }],
  ],
  resize_keyboard: true,
};

interface PendingOtp {
  phone: string;
  storeId: string;
  expiresAt: number;
}

@Injectable()
export class SellerBotService {
  private readonly logger = new Logger(SellerBotService.name);
  private readonly webhookSecret?: string;
  private readonly botUsername: string | null;
  private readonly pendingOtp = new Map<string, PendingOtp>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly storeService: StoreService,
    private readonly storeCreditService: StoreCreditService,
    private readonly api: SellerBotApiClientService,
    private readonly refunds: RefundService,
    private readonly productEvents: ProductEventService,
  ) {
    this.webhookSecret = this.config.get<string>('SELLER_BOT_WEBHOOK_SECRET');
    this.botUsername =
      this.config.get<string>('SELLER_BOT_USERNAME')?.replace(/^@/, '').trim() ||
      null;
  }

  getBotUsername(): string | null {
    return this.botUsername;
  }

  verifySecret(secret: string | undefined): boolean {
    return !!this.webhookSecret && safeEqual(secret, this.webhookSecret);
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
          const promptText = message.reply_to_message?.text ?? '';
          const moneyFlag = promptText.match(REJECT_REASON_REF_REGEX)?.[2];
          const moneyReceived = moneyFlag === undefined ? undefined : moneyFlag === '1';
          await this.handleRejectReasonMessage(message, rejectOrderId, moneyReceived);
          return;
        }
        const stockProductId = this.extractRef(message, STOCK_UPDATE_REF_REGEX);
        if (stockProductId) {
          await this.handleStockUpdateMessage(message, stockProductId);
          return;
        }
        const conversationId = this.extractRef(
          message,
          CONVERSATION_REPLY_REF_REGEX,
        );
        if (conversationId) {
          await this.handleAttentionReplyMessage(message, conversationId);
          return;
        }
        if (message.reply_to_message?.text === fa.sellerBot.stockSearchPrompt) {
          await this.handleStockSearch(
            String(message.chat.id),
            message.text.trim(),
          );
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

  // بعد از هر اکشن تمام‌شده صدا زده می‌شود تا کیبرد منو همیشه پایین صفحه باشد — force_reply/
  // inline keyboard پیام‌های بعدی این را پاک نمی‌کنند، ولی صریح دوباره فرستادنش قابل‌اطمینان‌تر است
  private async sendMenu(chatId: string, text: string): Promise<void> {
    await this.api.sendText(chatId, text, MAIN_MENU_KEYBOARD);
  }

  private async handleText(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const text = message.text!.trim();

    if (text === '/start' || text.startsWith('/start ')) {
      await this.handleStart(chatId, text.slice('/start'.length).trim());
      return;
    }
    if (text === '/logout' || text === fa.sellerBot.menuLogoutButton) {
      await this.handleLogout(chatId);
      return;
    }
    if (text === '/help') {
      await this.sendMenu(chatId, fa.sellerBot.help);
      return;
    }
    if (text === '/today' || text === fa.sellerBot.menuTodayButton) {
      await this.handleToday(chatId);
      return;
    }
    if (text === '/orders' || text === fa.sellerBot.menuOrdersButton) {
      await this.handleOrders(chatId);
      return;
    }
    if (text === '/refunds') {
      await this.handleRefunds(chatId);
      return;
    }
    if (text === fa.sellerBot.menuAttentionButton) {
      await this.handleAttentionList(chatId);
      return;
    }
    if (text === fa.sellerBot.menuStockButton) {
      await this.handleStockPrompt(chatId);
      return;
    }
    if (text === '/stock' || text.startsWith('/stock ')) {
      await this.handleStockSearch(chatId, text.slice('/stock'.length).trim());
      return;
    }
    if (text === '/credit' || text === fa.sellerBot.menuCreditButton) {
      await this.handleCredit(chatId);
      return;
    }

    const pending = this.pendingOtp.get(chatId);
    if (pending) {
      await this.handleOtpAttempt(chatId, pending, text);
      return;
    }

    await this.sendMenu(chatId, fa.sellerBot.unknownCommand);
  }

  // SP-7/S9 — اتصال با یک تپ: t.me/<bot>?start=c_<token>؛ توکن یک‌بارمصرف با TTL ۱۵ دقیقه
  async createConnectToken(sellerId: string, storeId: string): Promise<{ url: string }> {
    const store = await this.storeService.getOwned(sellerId, storeId);
    if (!this.botUsername) throw new BadRequestException(fa.sellerBot.botNotConfigured);
    const token = randomBytes(16).toString('base64url');
    await this.prisma.store.update({
      where: { id: store.id },
      data: {
        sellerBotConnectToken: token,
        sellerBotConnectTokenExpiresAt: new Date(Date.now() + CONNECT_TOKEN_TTL_MS),
      },
    });
    return { url: `https://t.me/${this.botUsername}?start=c_${token}` };
  }

  private async linkByToken(chatId: string, token: string): Promise<void> {
    const store = await this.prisma.store.findFirst({
      where: { sellerBotConnectToken: token, sellerBotConnectTokenExpiresAt: { gt: new Date() } },
    });
    if (!store) {
      await this.api.sendText(chatId, fa.sellerBot.connectLinkExpired);
      return;
    }
    // این چت قبلاً به فروشگاه دیگری وصل است ← دزدیده نمی‌شود
    const existing = await this.getLinkedStore(chatId);
    if (existing && existing.id !== store.id) {
      await this.api.sendText(chatId, fa.sellerBot.chatAlreadyLinkedElsewhere);
      return;
    }
    try {
      await this.prisma.store.update({
        where: { id: store.id },
        data: {
          sellerBotChatId: chatId,
          sellerBotLinkedAt: new Date(),
          sellerBotConnectToken: null,
          sellerBotConnectTokenExpiresAt: null,
        },
      });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        await this.api.sendText(chatId, fa.sellerBot.chatAlreadyLinkedElsewhere);
        return;
      }
      throw err;
    }
    this.productEvents.log('seller_bot_linked', { storeId: store.id }, { via: 'deeplink' });
    await this.sendMenu(chatId, fa.sellerBot.linked(store.name));
  }

  private async handleStart(chatId: string, payload = ''): Promise<void> {
    if (payload.startsWith('c_')) {
      await this.linkByToken(chatId, payload.slice(2));
      return;
    }
    const store = await this.getLinkedStore(chatId);
    if (store) {
      await this.sendMenu(chatId, fa.sellerBot.alreadyLinked(store.name));
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
    this.productEvents.log('seller_bot_linked', { storeId: store.id }, { via: 'otp' });
    await this.sendMenu(chatId, fa.sellerBot.linked(store.name));
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
    await this.api.removeReplyKeyboard(chatId, fa.sellerBot.logoutSuccess);
  }

  private async requireLinkedStore(chatId: string): Promise<Store | null> {
    const store = await this.getLinkedStore(chatId);
    if (!store) {
      await this.api.sendText(chatId, fa.sellerBot.notLinked);
      return null;
    }
    return store;
  }

  private async handleToday(chatId: string): Promise<void> {
    const store = await this.requireLinkedStore(chatId);
    if (!store) return;
    const today = await this.storeService.listToday(store.sellerId, store.id);
    const sections: string[] = [];
    if (today.receipts.length > 0) {
      sections.push(
        fa.sellerBot.todayReceipts(today.receipts.length),
        ...today.receipts.map((order) => {
          const badge =
            order.receiptVerifiedMatch === true
              ? fa.sellerBot.todayReceiptMatch
              : order.receiptVerifiedMatch === false
                ? fa.sellerBot.todayReceiptMismatch
                : fa.sellerBot.todayReceiptPending;
          return `• ${order.orderCode} — ${badge}`;
        }),
      );
    }
    if (today.toShip.length > 0) {
      sections.push(
        fa.sellerBot.todayToShip(today.toShip.length),
        ...today.toShip.map((order) => `• ${order.orderCode}`),
      );
    }
    if (today.conversations.length > 0) {
      sections.push(
        fa.sellerBot.todayConversations(today.conversations.length),
        ...today.conversations.map((row) => `• ${row.customerLabel}`),
      );
    }
    if (today.refunds.length > 0) {
      sections.push(
        fa.sellerBot.todayRefunds(today.refunds.length),
        ...today.refunds.map((row) => `• ${row.orderCode}`),
      );
    }
    if (today.issues.length > 0) {
      sections.push(
        fa.sellerBot.todayIssues(today.issues.length),
        ...today.issues.map((row) => `• ${row.orderCode}`),
      );
    }
    if (today.lowStock.length > 0) {
      sections.push(
        fa.sellerBot.todayLowStock(today.lowStock.length),
        ...today.lowStock.map((row) =>
          fa.sellerBot.todayLowStockLine(row.name, row.stock),
        ),
      );
    }
    await this.sendMenu(
      chatId,
      sections.length > 0 ? sections.join('\n') : fa.sellerBot.todayEmpty,
    );
  }

  private async handleOrders(chatId: string): Promise<void> {
    const store = await this.requireLinkedStore(chatId);
    if (!store) return;

    const orders = (
      await this.storeService.listOrders(store.sellerId, store.id)
    ).slice(0, ORDERS_LIST_MAX);
    if (orders.length === 0) {
      await this.sendMenu(chatId, fa.sellerBot.ordersEmpty);
      return;
    }

    const lines = orders.map((o) => {
      const items = o.items as CartItem[];
      const itemsSummary = items
        .map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''}`)
        .join('، ');
      return fa.sellerBot.orderLine(
        itemsSummary,
        o.totalAmount,
        fa.sellerBot.orderStatusLabel[o.status] ?? o.status,
        o.createdAt,
      );
    });
    await this.sendMenu(
      chatId,
      `${fa.sellerBot.ordersHeader}\n\n${lines.join('\n')}`,
    );

    for (const order of orders) {
      if (order.status !== 'RECEIPT_SUBMITTED') continue;
      const items = order.items as CartItem[];
      const itemsSummary = items
        .map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''}`)
        .join('، ');
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

  private async handleRefunds(chatId: string): Promise<void> {
    const store = await this.getLinkedStore(chatId);
    if (!store) return;
    const rows = await this.refunds.list(store.sellerId, store.id, 'READY');
    if (rows.length === 0) {
      await this.api.sendText(chatId, fa.orderNotify.refundsEmpty);
      return;
    }
    const base = (this.config.get<string>('APP_URL') ?? '').replace(/\/$/, '');
    const panelUrl = base ? `${base}/seller/panel/orders?view=refunds` : '';
    for (const row of rows.slice(0, 8)) {
      await this.api.sendText(
        chatId,
        `${row.orderCode}\n${row.amountToman.toLocaleString('fa-IR')} تومان\n${row.destinationMasked ?? ''}`,
        {
          inline_keyboard: [
            [{ text: fa.orderNotify.refundMarkPaid, callback_data: `sbrf:${row.id}` }],
            ...(panelUrl
              ? [[{ text: fa.orderNotify.refundCopyInPanel, url: panelUrl }]]
              : []),
          ],
        },
      );
    }
  }

  private async handleRefundPaid(chatId: string, refundId: string): Promise<void> {
    const store = await this.getLinkedStore(chatId);
    if (!store) return;
    try {
      await this.refunds.markPaid(store.sellerId, store.id, refundId);
      await this.api.sendText(chatId, fa.orderNotify.refundMarkedPaid);
    } catch {
      await this.api.sendText(chatId, fa.order.refundNotPayable);
    }
  }

  private async handleCallback(cq: TelegramCallbackQuery): Promise<void> {
    const chatId = cq.message ? String(cq.message.chat.id) : String(cq.from.id);
    await this.api.answerCallbackQuery(cq.id);
    const data = cq.data ?? '';

    if (data.startsWith('sbok:')) {
      await this.handleApproveFromNotification(chatId, data.slice('sbok:'.length));
      return;
    }
    if (data.startsWith('sbap:') || data.startsWith('sbrj:')) {
      await this.handleOrderDecision(chatId, data);
      return;
    }
    if (data.startsWith('sbrm:')) {
      const moneyReceived = data[5] === '1';
      const orderId = data.slice(7);
      await this.api.sendForceReply(
        chatId,
        fa.sellerBot.orderRejectReasonPrompt(orderId, moneyReceived),
      );
      return;
    }
    if (data.startsWith('sbst:')) {
      await this.handleStockSelect(chatId, data.slice('sbst:'.length));
      return;
    }
    if (data.startsWith('sbub:')) {
      await this.handleBackToBot(chatId, data.slice('sbub:'.length));
      return;
    }
    if (data.startsWith('sbrp:')) {
      await this.handleAttentionReplyButton(chatId, data.slice('sbrp:'.length));
      return;
    }
    if (data.startsWith('sbrf:')) {
      await this.handleRefundPaid(chatId, data.slice('sbrf:'.length));
      return;
    }
  }

  private async handleApproveFromNotification(
    chatId: string,
    orderId: string,
  ): Promise<void> {
    const store = await this.getLinkedStore(chatId);
    if (!store) return;
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.storeId !== store.id) return;
    const base = (this.config.get<string>('APP_URL') ?? '').replace(/\/$/, '');
    const viewUrl = base ? `${base}/seller/panel/orders?orderId=${order.id}` : '';
    if (order.receiptVerifiedMatch !== true) {
      await this.api.sendText(
        chatId,
        viewUrl ? `${fa.orderNotify.receiptView}\n${viewUrl}` : fa.orderNotify.receiptView,
      );
      return;
    }
    try {
      await this.storeService.approveOrder(
        store.sellerId,
        store.id,
        orderId,
        'TELEGRAM',
      );
    } catch (err) {
      if (err instanceof ConflictException) {
        await this.api.sendText(chatId, err.message);
        return;
      }
      throw err;
    }
    await this.api.sendText(chatId, fa.sellerBot.orderApproved);
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
      let approved: Awaited<ReturnType<StoreService['approveOrder']>>;
      try {
        approved = await this.storeService.approveOrder(
          store.sellerId,
          store.id,
          orderId,
          'TELEGRAM',
        );
      } catch (err) {
        if (err instanceof ConflictException) {
          await this.sendMenu(chatId, err.message);
          return;
        }
        throw err;
      }
      await this.sendMenu(
        chatId,
        fa.sellerBot.orderApproved +
          (approved.stockWarnings.length > 0
            ? `\n\n${fa.sellerBot.stockShortageWarning(approved.stockWarnings)}`
            : ''),
      );
    } else {
      const needsMoneyAnswer =
        order.status === 'RECEIPT_SUBMITTED' ||
        order.status === 'APPROVED' ||
        !!order.receiptImageKey;
      if (needsMoneyAnswer) {
        await this.sendMoneyQuestion(chatId, orderId);
        return;
      }
      await this.api.sendForceReply(
        chatId,
        fa.sellerBot.orderRejectReasonPrompt(orderId),
      );
    }
  }

  private async sendMoneyQuestion(chatId: string, orderId: string): Promise<void> {
    await this.api.sendText(chatId, fa.sellerBot.orderRejectButton, {
      inline_keyboard: [
        [
          { text: fa.sellerBot.moneyArrivedButton, callback_data: `sbrm:1:${orderId}` },
          { text: fa.sellerBot.moneyMissingButton, callback_data: `sbrm:0:${orderId}` },
        ],
      ],
    });
  }

  private async handleRejectReasonMessage(
    message: TelegramMessage,
    orderId: string,
    moneyReceived?: boolean,
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
    try {
      await this.storeService.rejectOrder(
        store.sellerId,
        store.id,
        orderId,
        reason,
        'TELEGRAM',
        undefined,
        moneyReceived,
      );
    } catch (err) {
      if (err instanceof ConflictException) {
        await this.sendMenu(chatId, err.message);
        return;
      }
      // پیام جواب به پرامپت قدیمی (بدون فلگ پول) ← دوباره بپرس «پول نشسته/نرسیده» [R0.13]
      if (
        err instanceof BadRequestException &&
        err.message === fa.order.moneyReceivedRequired
      ) {
        await this.sendMoneyQuestion(chatId, orderId);
        return;
      }
      throw err;
    }
    await this.sendMenu(chatId, fa.sellerBot.orderRejected);
  }

  private async handleStockSearch(
    chatId: string,
    query: string,
  ): Promise<void> {
    const store = await this.requireLinkedStore(chatId);
    if (!store) return;
    if (!query) {
      await this.sendMenu(chatId, fa.sellerBot.stockUsage);
      return;
    }

    const products = await this.storeService.listProducts(
      store.sellerId,
      store.id,
    );
    const q = query.toLowerCase();
    const matches = products
      .filter((p) => p.status === 'ACTIVE' || p.status === 'HIDDEN')
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.code && p.code.toLowerCase().includes(q)),
      )
      .slice(0, STOCK_SEARCH_MAX_RESULTS);

    if (matches.length === 0) {
      await this.sendMenu(chatId, fa.sellerBot.stockSearchEmpty);
      return;
    }

    await this.api.sendText(chatId, fa.sellerBot.stockSearchHeader, {
      inline_keyboard: matches.map((p) => [
        {
          text: `${p.name}${p.status === 'HIDDEN' ? ' (مخفی)' : ''} (${p.trackStock ? `موجودی: ${p.stock}` : fa.sellerBot.alwaysInStockShort})`,
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
    if (!product.trackStock) {
      await this.sendMenu(chatId, fa.sellerBot.alwaysInStockNotice);
      return;
    }

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
    if (!product.trackStock) {
      await this.sendMenu(chatId, fa.sellerBot.alwaysInStockNotice);
      return;
    }

    const text = message.text?.trim() ?? '';
    const stock = Number(text);
    if (!/^\d+$/.test(text) || !Number.isInteger(stock)) {
      await this.sendMenu(chatId, fa.sellerBot.stockInvalidNumber);
      return;
    }

    await this.storeService.updateProduct(store.sellerId, store.id, productId, {
      stock,
    });
    await this.sendMenu(chatId, fa.sellerBot.stockUpdated(product.name, stock));
  }

  private async handleStockPrompt(chatId: string): Promise<void> {
    const store = await this.requireLinkedStore(chatId);
    if (!store) return;
    await this.api.sendForceReply(chatId, fa.sellerBot.stockSearchPrompt);
  }

  private async handleCredit(chatId: string): Promise<void> {
    const store = await this.requireLinkedStore(chatId);
    if (!store) return;
    const status = await this.storeCreditService.getStatus(
      store.sellerId,
      store.id,
    );
    await this.sendMenu(
      chatId,
      fa.sellerBot.creditBalance(status.balanceToman),
    );
  }

  // docs/PRD-seller-telegram-management-bot.md — فاز ۲: «گفتگوهای نیازمند توجه» (همان
  // StoreService.listNeededAttention که پنل وب هم استفاده می‌کند)، با دکمه‌ی پاسخ روی هرکدام
  private async handleAttentionList(chatId: string): Promise<void> {
    const store = await this.requireLinkedStore(chatId);
    if (!store) return;

    const conversations = (
      await this.storeService.listNeededAttention(store.sellerId, store.id)
    ).slice(0, ATTENTION_LIST_MAX);
    if (conversations.length === 0) {
      await this.sendMenu(chatId, fa.sellerBot.attentionEmpty);
      return;
    }

    const lines = conversations.map((c) =>
      fa.sellerBot.attentionLine(c.customerLabel, c.updatedAt),
    );
    await this.sendMenu(
      chatId,
      `${fa.sellerBot.attentionHeader}\n\n${lines.join('\n')}`,
    );

    for (const conversation of conversations) {
      await this.api.sendText(
        chatId,
        fa.sellerBot.attentionLine(
          conversation.customerLabel,
          conversation.updatedAt,
        ),
        {
          inline_keyboard: [
            [
              {
                text: fa.sellerBot.attentionReplyButton,
                callback_data: `sbrp:${conversation.id}`,
              },
            ],
          ],
        },
      );
    }
  }

  // 0.8 — «برگشت به بات»: همان unmute پنل (ownership داخل سرویس چک می‌شود)
  private async handleBackToBot(
    chatId: string,
    conversationId: string,
  ): Promise<void> {
    const store = await this.getLinkedStore(chatId);
    if (!store) return;
    try {
      await this.storeService.unmuteConversation(
        store.sellerId,
        store.id,
        conversationId,
      );
      await this.sendMenu(chatId, fa.sellerBot.backToBotDone);
    } catch (err) {
      this.logger.error(
        `handleBackToBot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.sendMenu(chatId, fa.sellerBot.genericError);
    }
  }

  private async handleAttentionReplyButton(
    chatId: string,
    conversationId: string,
  ): Promise<void> {
    const store = await this.getLinkedStore(chatId);
    if (!store) return;
    await this.api.sendForceReply(
      chatId,
      fa.sellerBot.attentionReplyPrompt(conversationId),
    );
  }

  private async handleAttentionReplyMessage(
    message: TelegramMessage,
    conversationId: string,
  ): Promise<void> {
    const chatId = String(message.chat.id);
    const store = await this.getLinkedStore(chatId);
    if (!store) return;
    const text = message.text?.trim();
    if (!text) return;
    try {
      await this.storeService.sendSellerMessage(
        store.sellerId,
        store.id,
        conversationId,
        text,
      );
      await this.sendMenu(chatId, fa.sellerBot.attentionReplySent);
      // 0.8 — پیام فروشنده AI را ساکت کرد؛ راه برگشت به بات
      await this.api.sendText(chatId, fa.sellerBot.aiPausedNotice, {
        inline_keyboard: [
          [
            {
              text: fa.sellerBot.backToBotButton,
              callback_data: `sbub:${conversationId}`,
            },
          ],
        ],
      });
    } catch (err) {
      this.logger.error(
        `handleAttentionReplyMessage failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.sendMenu(chatId, fa.sellerBot.genericError);
    }
  }
}
