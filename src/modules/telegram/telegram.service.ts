import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Store, Product } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import {
  AsrService,
  VOICE_MESSAGE_ASR_CHAIN,
} from '../../common/services/asr.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import {
  ConversationEngineService,
  type ConversationWithStore,
} from '../sales-agent/conversation-engine.service';
import { CreditService } from '../sales-agent/credit.service';
import { StoreService } from '../store/store.service';
import {
  StoreKbService,
  type ExtractProductsResult,
} from '../store/store-kb.service';
import {
  pickVariant,
  pickVoiceVariant,
  pickResponseStrategy,
} from '../sales-agent/model-variants';
import { buildAsrVocabHint } from '../sales-agent/asr-vocab-hint';
import { buildHistoryEntry } from '../sales-agent/conversation-history.util';
import { reattachReceiptIfOrderOpen } from '../sales-agent/receipt-reattach.util';
import type {
  EngineResult,
  SalesAction,
  UiBlock,
} from '../sales-agent/sales-agent.types';
import { fa } from '../../i18n/fa';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';
import type {
  TelegramCallbackQuery,
  TelegramInlineKeyboard,
  TelegramKeyboard,
  TelegramMessage,
  TelegramUpdate,
} from './telegram.types';
import { randomUUID } from 'crypto';

// docs/PRD-product-strategy-and-roadmap.md بخش ۶ آیتم #۲۱ — از ۵ نتیجه‌ی نمایش‌داده‌شده‌ی سرچ
// فروشگاه، حداکثر همین تعداد می‌توانند ⭐ باشند؛ حل «۳۰ نفر هم‌زمان بخرن» را به «همه نوبتی دیده
// می‌شوند» تبدیل می‌کند، نه «هرکی اول خرید همیشه برنده است»
const SPONSORED_SLOT_CAP = 2;

// docs/PRD-bulk-product-import-from-document.md — نتیجه‌ی استخراج تا تایید فروشنده (دکمه‌ی
// inline) در حافظه نگه داشته می‌شود؛ نیازی به جدول دیتابیس نیست چون کل چرخه عمرش چند دقیقه است
const BULK_IMPORT_TTL_MS = 15 * 60 * 1000;
const BULK_IMPORT_MAX_FILE_BYTES = 15 * 1024 * 1024;

interface PendingBulkImport {
  chatId: string;
  storeId: string;
  sellerId: string;
  items: ExtractProductsResult['items'];
  createdAt: number;
}

interface LoadedMediaItem {
  type: 'photo' | 'video';
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

// docs/PRD-telegram-bot-channel.md بخش ۴ — آداپتور کانال تلگرام؛ هسته‌ی ایجنت
// (ConversationEngineService) هیچ تغییری نمی‌بیند، این سرویس فقط پیام‌های تلگرام را به همان
// handleMessage/handleAction/handleReceiptUpload موجود وصل می‌کند.
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken?: string;
  private readonly webhookSecret?: string;
  // ایران تلگرام را فیلتر می‌کند — وبهوک ورودی (تلگرام→ما) مشکلی ندارد چون اتصال از بیرون ایران
  // شروع می‌شود، ولی هر فراخوانی خروجی این سرویس به api.telegram.org (ارسال پاسخ/دانلود فایل)
  // از سرور پروداکشن (داخل ایران) مستقیم بزند تایم‌اوت می‌گیرد. راه‌حل همان الگوی موجود پروژه
  // برای OpenRouter/Kie.ai است (openrouter-relay/server.js، مسیرهای /kie و /kie-upload) — یک
  // route جدید /telegram روی همان relay اضافه شد؛ اینجا فقط baseURL پیش‌فرض عوض می‌شود و یک
  // هدر X-Relay-Secret اضافه می‌شود، نیازی به proxy/dispatcher سطح شبکه نیست.
  private readonly apiBaseUrl: string;
  private readonly relaySecret?: string;
  // docs/PRD-bulk-product-import-from-document.md
  private readonly pendingBulkImports = new Map<string, PendingBulkImport>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ConversationEngineService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly asr: AsrService,
    private readonly aiProvider: AiProviderService,
    private readonly creditService: CreditService,
    private readonly storeService: StoreService,
    private readonly storeKbService: StoreKbService,
  ) {
    this.botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    this.webhookSecret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    this.apiBaseUrl =
      this.config.get<string>('TELEGRAM_API_BASE_URL') ??
      'https://api.telegram.org';
    this.relaySecret = this.config.get<string>('TELEGRAM_RELAY_SECRET');
    // این خط فقط یک‌بار موقع بالا آمدن اپ چاپ می‌شود — با این می‌شود از خودِ لاگ بک‌اند
    // (بدون نیاز به curl) فهمید که آیا این پراسسِ در حال اجرا اصلاً env varهای تلگرام را
    // دارد یا خیر (مثلاً بعد از ست‌کردن env روی همروش، اگر ری‌دیپلوی نشده باشد، این پراسس
    // قدیمی هنوز بدون آن‌ها بالاست و این خط آن را لو می‌دهد).
    this.logger.log(
      `telegram config: botToken=${this.botToken ? 'set' : 'MISSING'} webhookSecret=${
        this.webhookSecret ? 'set' : 'MISSING'
      } apiBaseUrl=${this.apiBaseUrl} relaySecret=${this.relaySecret ? 'set' : 'not set (direct, dev only)'}`,
    );
  }

  private get relayHeaders(): Record<string, string> {
    return this.relaySecret ? { 'X-Relay-Secret': this.relaySecret } : {};
  }

  verifySecret(secret: string | undefined): boolean {
    return !!this.webhookSecret && secret === this.webhookSecret;
  }

  // docs/PRD-sales-agent-voice.md بخش ۱.۵ — صدا زده می‌شود از sales-agent-voice.processor.ts
  // وقتی وویس یک پاسخ آماده شد و مکالمه از کانال تلگرام است. عمداً sendAudio (نه sendVoice
  // بومی) چون sendVoice نیازمند OGG/Opus است و ترنسکود آن فعلاً خارج از این فاز است.
  //
  // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — قبلاً اینجا فقط URL فایل به تلگرام داده می‌شد (sendAudio با
  // audio=url) تا خودِ سرور تلگرام آن را fetch کند؛ با curl مستقیم تایید شد که آن URL کاملاً
  // سالم/در دسترس است (۲۰۰، MP3 معتبر با Content-Type درست)، ولی تلگرام همچنان «Bad Request:
  // failed to get HTTP URL content» برمی‌گرداند — یعنی مشکل از سمت ما قابل‌مشاهده نیست، بلکه
  // سرورهای تلگرام قادر به fetchکردن از بک‌اند میزبانی‌شده در ایران نیستند (برخلاف sendPhoto/
  // sendVideo که همچنان با URL کار می‌کنند چون معمولاً silent fail می‌شوند و کسی متوجه نشده،
  // نه چون واقعاً متفاوت‌اند). راه‌حل مطمئنی که از این وابستگی رد می‌شود (و عیناً همون الگوی
  // sendPhotoBuffer در telegram-api-client.service.ts است): خودِ بایت فایل مستقیم آپلود شود،
  // نه یک URL برای fetchکردن.
  async sendVoiceReadyBuffer(chatId: string, buffer: Buffer): Promise<void> {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append(
      'audio',
      new Blob([new Uint8Array(buffer)], { type: 'audio/mpeg' }),
      'voice.mp3',
    );
    await this.callApi('sendAudio', form);
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — تا وقتی وویس آماده نشده (تا ~۲ دقیقه طول می‌کشد)، مشتری هیچ
  // نشانه‌ای نمی‌بیند که ربات دارد صدا آماده می‌کند؛ sendChatAction نشانگر بومی تلگرام («در
  // حال ضبط صدا...») است، نه یک پیام متنی جدا. طبق مستندات تلگرام هر ارسال فقط ~۵ ثانیه
  // نمایش داده می‌شود، پس باید در حین انتظار تکرار شود (sales-agent-voice.processor.ts)
  async sendRecordingVoiceAction(chatId: string): Promise<void> {
    await this.callApi('sendChatAction', {
      chat_id: chatId,
      action: 'record_voice',
    });
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    try {
      if (update.callback_query) {
        this.logger.debug(
          `handling callback_query data=${update.callback_query.data}`,
        );
        await this.handleCallback(update.callback_query);
        return;
      }
      const message = update.message;
      if (!message) {
        this.logger.debug('update has no message/callback_query, ignored');
        return;
      }

      if (message.text?.startsWith('/start')) {
        this.logger.debug(`handling /start chat=${message.chat.id}`);
        await this.handleStart(message);
        return;
      }
      if (message.text?.startsWith('/history')) {
        this.logger.debug(`handling /history chat=${message.chat.id}`);
        await this.handleHistory(message);
        return;
      }
      // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۲ — دکمه‌های منوی ثابت (Reply
      // Keyboard) متن دقیق خودشان را به‌عنوان یک پیام معمولی برمی‌گردانند، نه یک callback جدا؛
      // باید قبل از handleText عمومی چک شوند تا به‌جای جستجوی فروشگاه/پیام مشتری تفسیر نشوند
      if (message.text === fa.telegram.menuOrders) {
        await this.handleHistory(message);
        return;
      }
      if (message.text === fa.telegram.menuCart) {
        await this.handleMenuCart(message);
        return;
      }
      if (message.photo?.length) {
        await this.handlePhoto(message);
        return;
      }
      // docs/PRD-bulk-product-import-from-document.md — سند PDF/Word فقط از چت شخصی‌ی
      // فروشنده‌ی متصل معنی دارد (ownerTelegramChatId)؛ هیچ مسیر دیگری امروز سند را مصرف
      // نمی‌کند، پس برای چت‌های غیرمالک بی‌صدا نادیده گرفته می‌شود (رفتار قبلی هم همین بود)
      if (message.document) {
        await this.handleSellerBulkImportDocument(message);
        return;
      }
      if (message.voice) {
        // چت شخصی فروشنده: پیام صوتی یعنی «این صوت رو برای افزودن/آپدیت محصول بخون»، نه
        // پیام مشتری — باید قبل از handleVoice (مسیر خریدار) چک شود
        const handledAsSeller = await this.trySellerBulkImportVoice(message);
        if (handledAsSeller) return;
        await this.handleVoice(message);
        return;
      }
      if (message.text) {
        // فیدبک کاربر — عیناً الگوی force_reply پایین برای جواب فروشنده، برای گرفتن دلیل رد
        // سفارش؛ باید قبل از handleText چک شود
        const sellerRejectReasonOrderId =
          this.extractSellerRejectReasonRef(message);
        if (sellerRejectReasonOrderId) {
          await this.handleSellerRejectReasonMessage(
            message,
            sellerRejectReasonOrderId,
          );
          return;
        }
        // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — جواب فروشنده به پیام force_reply (نه
        // مشتری‌ای که در حال خریده)؛ باید قبل از handleText (که مکالمه‌ی مشتری را می‌جوید) چک شود
        const sellerReplyConversationId = this.extractSellerReplyRef(message);
        if (sellerReplyConversationId) {
          await this.handleSellerReplyMessage(
            message,
            sellerReplyConversationId,
          );
          return;
        }
        await this.handleText(message);
        return;
      }
    } catch (err) {
      // قبلاً فقط err.message لاگ می‌شد — stack هم اضافه شد چون این تنها جایی است که خطاهای
      // داخلی handleUpdate اصلاً دیده می‌شوند (کنترلر همیشه {ok:true} برمی‌گرداند، تلگرام هم
      // هیچ خطایی نمی‌بیند)؛ بدون stack پیداکردن خط دقیق خطا عملاً غیرممکن بود.
      this.logger.error(
        `handleUpdate failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private async handleStart(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const payload = message.text!.trim().split(/\s+/)[1];
    if (!payload) {
      await this.sendText(chatId, fa.telegram.startNeedsLink);
      return;
    }

    // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — دیپ‌لینک اتصال تلگرام فروشنده، جدا از
    // دیپ‌لینک مشتری‌محور زیر (که با slug فروشگاه است، نه یک توکن)
    if (payload.startsWith('seller_')) {
      await this.handleSellerConnect(chatId, payload.slice('seller_'.length));
      return;
    }

    // docs/PRD-product-display-focus-and-variations.md §۲.۴ — لینک اختصاصی یک محصول؛ کد
    // کوتاه چون UUID خام محصول در کنار slug از سقف ۶۴ کاراکتری payload تلگرام رد می‌شود
    if (payload.startsWith('p_')) {
      const product = await this.prisma.product.findUnique({
        where: { telegramShortCode: payload.slice('p_'.length) },
        include: { store: true },
      });
      if (!product || product.store.status !== 'ACTIVE') {
        await this.sendText(chatId, fa.store.notFound);
        return;
      }
      await this.startChatForStore(
        chatId,
        product.store,
        message.from?.first_name,
        product,
      );
      return;
    }

    const store = await this.prisma.store.findUnique({
      where: { slug: payload },
    });
    if (!store || store.status !== 'ACTIVE') {
      await this.sendText(chatId, fa.store.notFound);
      return;
    }
    await this.startChatForStore(chatId, store, message.from?.first_name);
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — Store.telegramConnectToken یک‌بارمصرف است،
  // بلافاصله بعد از مصرف پاک می‌شود تا همان لینک دوباره کار نکند
  private async handleSellerConnect(
    chatId: string,
    token: string,
  ): Promise<void> {
    const store = await this.prisma.store.findFirst({
      where: {
        telegramConnectToken: token,
        telegramConnectTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!store) {
      await this.sendText(chatId, fa.telegram.sellerConnectInvalid);
      return;
    }
    await this.prisma.store.update({
      where: { id: store.id },
      data: {
        ownerTelegramChatId: chatId,
        telegramConnectToken: null,
        telegramConnectTokenExpiresAt: null,
      },
    });
    await this.sendText(chatId, fa.telegram.sellerConnected(store.name));
  }

  // مشترک بین دیپ‌لینک مستقیم (?start=<slug>) و انتخاب از نتایج جستجوی نام (بخش ۹.۲،
  // callback_data: 'st:<storeId>') — قبلاً فقط داخل handleStart بود. پارامتر اختیاری
  // product فقط از دیپ‌لینک اختصاصی محصول (p_<code>) پر می‌شود
  // (docs/PRD-product-display-focus-and-variations.md §۲.۴)
  private async startChatForStore(
    chatId: string,
    store: Store,
    firstName?: string,
    product?: Product,
  ): Promise<void> {
    const existing = await this.prisma.customer.findUnique({
      where: {
        storeId_telegramChatId: { storeId: store.id, telegramChatId: chatId },
      },
      include: {
        salesConversations: {
          where: { archivedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    let conversationId: string;
    if (existing?.salesConversations.length) {
      // فیدبک کاربر ۱۴۰۵/۰۷/۱۲: کاربری لینک /start را دوباره زد (یعنی صریحاً «از نو شروع کن»)
      // ولی چون مکالمه‌ی قبلی هنوز archivedAt نداشت (نصفه‌کاره مانده بود، نه تکمیل/رد‌شده)،
      // همان مکالمه‌ی قدیمی (با کارت/وضعیت کهنه) بی‌صدا ادامه پیدا می‌کرد — از دید کاربر
      // انگار اصلاً سشن جدیدی شروع نشده بود. حالا دقیقاً مثل الگوی موجود restartConversation
      // در sales-agent.service.ts («گفتگوی جدید» در وب): مکالمه‌ی قبلی آرشیو می‌شود و یک
      // SalesConversation تازه برای همان Customer ساخته می‌شود — نه یک Customer جدید
      const billingMode = await this.creditService.decideBillingMode(store.id);
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.salesConversation.update({
          where: { id: existing.salesConversations[0].id },
          data: { archivedAt: new Date() },
        });
        return tx.salesConversation.create({
          data: {
            storeId: store.id,
            customerId: existing.id,
            abVariant: pickVariant(),
            voiceVariant: pickVoiceVariant(),
            responseStrategy: pickResponseStrategy(),
            billingMode,
          },
        });
      });
      conversationId = created.id;
    } else if (existing) {
      // مشتری قبلاً این فروشگاه را دیده ولی مکالمه‌ی فعالی ندارد (آخرینش تکمیل/رد شده) —
      // docs/PRD-conversation-history.md: همان Customer می‌ماند، فقط یک مکالمه‌ی تازه
      const billingMode = await this.creditService.decideBillingMode(store.id);
      const created = await this.prisma.salesConversation.create({
        data: {
          storeId: store.id,
          customerId: existing.id,
          abVariant: pickVariant(),
          voiceVariant: pickVoiceVariant(),
          responseStrategy: pickResponseStrategy(),
          billingMode,
        },
      });
      conversationId = created.id;
    } else {
      // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶.۳ — معادل تلگرامی startChat
      // وب: اولین Customer این فروشگاه، پس اگر اولین چت است همین‌جا دوره‌ی آزمایشی گرنت می‌شود
      await this.creditService.grantTrialIfFirstChat(store.id);
      // docs/PRD-seller-credit-billing.md — یک‌بار همین‌جا تعیین می‌شود، معادل startChat وب
      const billingMode = await this.creditService.decideBillingMode(store.id);
      const customer = await this.prisma.customer.create({
        data: {
          storeId: store.id,
          channel: 'TELEGRAM',
          telegramChatId: chatId,
          // docs/PRD-sales-agent-voice.md بخش ۶.۴ — فقط همین یک‌بار، در ساخت Customer؛ هیچ‌جای
          // دیگر بازنویسی نمی‌شود (fullName فیلد عمومی موجود روی Customer است)
          fullName: firstName,
          salesConversations: {
            create: {
              storeId: store.id,
              abVariant: pickVariant(),
              voiceVariant: pickVoiceVariant(),
              responseStrategy: pickResponseStrategy(),
              billingMode,
            },
          },
        },
        include: { salesConversations: true },
      });
      conversationId = customer.salesConversations[0].id;
    }

    const conversation = await this.loadConversation(conversationId);
    if (!conversation) return;
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۴ — عکس پروفایل فروشگاه، فقط همین یک‌بار
    // در شروع مکالمه (مثل منوی پایین، بالا)؛ اگر فروشگاه عکس ندارد اصلاً فراخوانی نمی‌شود
    if (store.logoImageKey) {
      const logo = await this.loadImageMedia(store.logoImageKey);
      if (logo) {
        await this.sendPhotoBuffer(
          chatId,
          logo.buffer,
          store.logoImageKey,
          logo.mimeType,
          store.name,
        );
      }
    }
    const result = product
      ? await this.engine.showProduct(conversation, product)
      : await this.engine.startBrowse(conversation);
    await this.sendEngineResult(chatId, result);
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۲ — فقط یک‌بار در شروع هر مکالمه‌ی
    // فروشگاه؛ Reply Keyboard تا وقتی حذفش نکنیم (remove_keyboard) پایین صفحه‌ی خریدار می‌ماند،
    // نیازی به فرستادن دوباره‌اش در هر پیام نیست
    await this.sendText(chatId, fa.telegram.menuIntro, this.mainMenuKeyboard());
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۲ — فقط چند اکشن کلی/ثابت که همیشه معنی
  // دارند، نه نتایج دینامیک (آن‌ها inline می‌مانند، بخش ۵.۱۲ توضیح می‌دهد چرا)
  private mainMenuKeyboard(): TelegramKeyboard {
    return {
      keyboard: [
        [{ text: fa.telegram.menuOrders }, { text: fa.telegram.menuCart }],
      ],
      resize_keyboard: true,
    };
  }

  // دکمه‌ی ثابت «🛒 سبد فعلی» — دقیقاً همان مسیر handleText عادی (parseIntent متن را
  // VIEW_CART تشخیص می‌دهد)، فقط وقتی مکالمه‌ی فعالی نیست پیام روشن‌تری می‌دهد به‌جای اینکه
  // به‌اشتباه به‌عنوان جستجوی نام فروشگاه («🛒 سبد فعلی») تفسیر شود
  private async handleMenuCart(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const conversation = await this.resolveActiveConversation(chatId);
    if (!conversation) {
      await this.sendText(chatId, fa.telegram.noActiveStore);
      return;
    }
    if (conversation.isMutedForHuman) {
      await this.logCustomerMessage(conversation.id, message.text ?? '');
      return;
    }
    const result = await this.engine.handleMessage(
      conversation,
      message.text ?? '',
    );
    await this.sendEngineResult(chatId, result);
  }

  private async handleText(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const conversation = await this.resolveActiveConversation(chatId);
    if (!conversation) {
      // docs/PRD-telegram-bot-channel.md بخش ۹.۲ — بدون مکالمه‌ی فعال، متن به‌عنوان جستجوی
      // نام فروشگاه در نظر گرفته می‌شود، نه فقط یک پیام رد شده
      await this.searchStores(chatId, message.text ?? '');
      return;
    }
    if (conversation.isMutedForHuman) {
      await this.logCustomerMessage(conversation.id, message.text ?? '');
      return;
    }
    const result = await this.withTypingIndicator(chatId, () =>
      this.engine.handleMessage(conversation, message.text ?? ''),
    );
    await this.sendEngineResult(chatId, result);
  }

  private async searchStores(chatId: string, query: string): Promise<void> {
    const q = query.trim();
    if (!q) {
      await this.sendText(chatId, fa.telegram.noActiveStore);
      return;
    }
    // docs/PRD-seller-advertising-placements.md بخش ۳ — نتایج مرتبط عوض نمی‌شوند، فقط رتبه‌ی
    // فروشگاه‌های تبلیغ‌شده در همین نتایج بالاتر می‌رود؛ ۱۰ تا می‌گیریم تا بعد از رتبه‌بندی هم
    // ۵ تای نهایی معنی‌دار بماند
    // docs/PRD-product-strategy-and-roadmap.md بخش ۶ آیتم #۲۲ — قبلاً فقط اسم فروشگاه مچ می‌شد؛
    // یعنی خریداری که «خرید کفش» یا «کفش نایک» تایپ می‌کرد (قصد خرید/دسته‌بندی، نه اسم فروشگاه)
    // هیچ نتیجه‌ای نمی‌گرفت، حتی اگه یک فروشگاه دقیقاً دسته‌بندی «کیف و کفش» یا محصولی به اسم
    // «کفش نایک» داشت. الان اول اسم/دسته‌بندی فروشگاه مچ می‌شود؛ اگه کافی نبود (کمتر از ۱۰ تا)،
    // فروشگاه‌هایی که حداقل یک محصول با این نام دارند هم اضافه می‌شوند (همان الگوی contains
    // insensitive که searchProducts برای جستجوی داخل‌فروشگاهی استفاده می‌کند)
    const nameOrCategoryMatches = await this.prisma.store.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { category: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 10,
    });
    let stores = nameOrCategoryMatches;
    if (stores.length < 10) {
      const matchedIds = nameOrCategoryMatches.map((s) => s.id);
      const productMatches = await this.prisma.product.findMany({
        where: {
          name: { contains: q, mode: 'insensitive' },
          store: { status: 'ACTIVE', id: { notIn: matchedIds } },
        },
        distinct: ['storeId'],
        select: { store: true },
        take: 10 - stores.length,
      });
      stores = [...stores, ...productMatches.map((p) => p.store)];
    }
    if (stores.length === 0) {
      await this.sendText(chatId, fa.telegram.storeSearchEmpty);
      return;
    }
    const activePlacements = await this.prisma.adPlacement.findMany({
      where: {
        storeId: { in: stores.map((s) => s.id) },
        placement: 'TELEGRAM_STORE_SEARCH',
        status: 'ACTIVE',
        endsAt: { gt: new Date() },
      },
      select: { storeId: true, impressionCount: true },
    });
    // docs/PRD-product-strategy-and-roadmap.md بخش ۶ آیتم #۲۱ — قبلاً هر چندتا فروشگاه تبلیغ‌شده
    // که مچ می‌شدند همه بالا می‌رفتند (حتی هر ۵ تای نمایش‌داده‌شده)، و بین خودشان هم ترتیب
    // مشخصی نداشتند (خروجی بدون ORDER BY پستگرس). الان: حداکثر SPONSORED_SLOT_CAP تا از نتایج
    // نهایی می‌توانند ⭐ باشند، و از بین همه‌ی تبلیغ‌شده‌های مچ‌شده، آن‌هایی انتخاب می‌شوند که
    // impressionCount کمتری دارند (چرخش بر اساس کمترین نمایش) — نه یک برنده‌ی ثابت همیشگی.
    const leastShownFirst = [...activePlacements].sort(
      (a, b) => a.impressionCount - b.impressionCount,
    );
    const featuredIds = new Set(
      leastShownFirst.slice(0, SPONSORED_SLOT_CAP).map((p) => p.storeId),
    );
    const featuredOrder = new Map(
      leastShownFirst.map((p, i) => [p.storeId, i]),
    );
    const featuredStores = stores
      .filter((s) => featuredIds.has(s.id))
      .sort((a, b) => featuredOrder.get(a.id)! - featuredOrder.get(b.id)!);
    const organicStores = stores.filter((s) => !featuredIds.has(s.id));
    const top = [...featuredStores, ...organicStores].slice(0, 5);

    const shownFeaturedIds = top
      .filter((s) => featuredIds.has(s.id))
      .map((s) => s.id);
    if (shownFeaturedIds.length > 0) {
      // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۳ — فقط شمارش «نشان داده شد»،
      // طبق تصمیم خودِ PRD-seller-advertising-placements.md که نرخ کلیک را عمداً خارج از فاز
      // گذاشت؛ فقط همان‌هایی که واقعاً در ۵ تای نهایی دیده شدند زیاد می‌شوند (نه کل ۱۰ تای اولیه)
      await this.prisma.adPlacement.updateMany({
        where: {
          storeId: { in: shownFeaturedIds },
          placement: 'TELEGRAM_STORE_SEARCH',
          status: 'ACTIVE',
          endsAt: { gt: new Date() },
        },
        data: { impressionCount: { increment: 1 } },
      });
    }
    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: top.map((s) => [
        {
          text: featuredIds.has(s.id) ? `⭐ ${s.name}` : s.name,
          callback_data: `st:${s.id}`,
        },
      ]),
    };
    await this.sendText(chatId, fa.telegram.storeSearchResults, keyboard);
  }

  private async handleCallback(cq: TelegramCallbackQuery): Promise<void> {
    const chatId = cq.message ? String(cq.message.chat.id) : String(cq.from.id);
    await this.answerCallbackQuery(cq.id);

    const data = cq.data ?? '';
    // docs/PRD-conversation-history.md بخش ۵ — فقط‌خواندنی، مستقل از «مکالمه‌ی فعال» است
    if (data.startsWith('h:')) {
      await this.handleHistorySelect(chatId, data.slice(2));
      return;
    }
    // docs/PRD-telegram-bot-channel.md بخش ۹.۲ — انتخاب از نتایج جستجوی نام فروشگاه
    if (data.startsWith('st:')) {
      const store = await this.prisma.store.findUnique({
        where: { id: data.slice(3) },
      });
      if (!store || store.status !== 'ACTIVE') {
        await this.sendText(chatId, fa.store.notFound);
        return;
      }
      await this.startChatForStore(chatId, store, cq.from.first_name);
      return;
    }
    // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — این دو روی چت خودِ فروشنده اجرا می‌شوند
    // (نه یک مکالمه‌ی خریدار)، پس باید قبل از resolveActiveConversation زیر مچ شوند
    if (data.startsWith('sr:')) {
      await this.handleSellerReplyButton(chatId, data.slice(3));
      return;
    }
    if (data.startsWith('sap:') || data.startsWith('srj:')) {
      await this.handleSellerOrderDecision(chatId, data);
      return;
    }
    // docs/PRD-bulk-product-import-from-document.md — تایید نهایی اعمال محصولات استخراج‌شده
    if (data.startsWith('bpi:')) {
      await this.handleBulkImportConfirm(chatId, data.slice(4));
      return;
    }

    const conversation = await this.resolveActiveConversation(chatId);
    if (!conversation) return;

    let action: SalesAction | null = null;
    if (data.startsWith('ac:'))
      action = { type: 'ADD_TO_CART', productId: data.slice(3) };
    else if (data === 'cc') action = { type: 'CONFIRM_CART' };
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ — دکمه‌های فلوی آدرس
    else if (data.startsWith('sa:'))
      action = { type: 'SELECT_ADDRESS', addressId: data.slice(3) };
    else if (data === 'na') action = { type: 'NEW_ADDRESS' };
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — انتخاب استان دکمه‌ای
    else if (data.startsWith('pv:'))
      action = { type: 'SELECT_PROVINCE', province: data.slice(3) };
    else if (data === 'ca') action = { type: 'CONFIRM_ADDRESS' };
    else if (data === 'ea') action = { type: 'EDIT_ADDRESS' };
    else if (data === 'sva') action = { type: 'SAVE_ADDRESS' };
    else if (data === 'nsa') action = { type: 'SKIP_SAVE_ADDRESS' };
    // docs/PRD-product-display-focus-and-variations.md §۴.۲ — چیپ انتخاب واریانت؛ value یک
    // مقدار گزینه («M») یا (mode=ALTERNATIVES) یک UUID ترکیب موجود است، هر دو کوتاه و بی‌خطر
    // برای callback_data (عیناً همون فرض pv: برای اسم استان)
    else if (data.startsWith('vv:'))
      action = { type: 'SELECT_VARIANT_VALUE', value: data.slice(3) };
    if (!action) return;

    if (conversation.isMutedForHuman) return;
    const result = await this.engine.handleAction(conversation, action);
    await this.sendEngineResult(chatId, result);
  }

  // docs/PRD-conversation-history.md بخش ۵ — /history: لیست inline از مکالمات این chatId در
  // همه‌ی فروشگاه‌ها (یک telegramChatId می‌تواند چند Customer/فروشگاه داشته باشد)
  private async handleHistory(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const customers = await this.prisma.customer.findMany({
      where: { channel: 'TELEGRAM', telegramChatId: chatId },
      include: { store: true, salesConversations: true },
    });
    const entries = customers
      .flatMap((c) =>
        c.salesConversations.map((conv) =>
          buildHistoryEntry(conv, c.store.name),
        ),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 10);

    if (entries.length === 0) {
      await this.sendText(chatId, fa.telegram.historyEmpty);
      return;
    }

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: entries.map((e) => [
        {
          text: fa.telegram.historyButtonLabel(
            e.storeName,
            e.lastProductName,
            fa.telegram.historyStatusLabels[e.status],
          ),
          callback_data: `h:${e.conversationId}`,
        },
      ]),
    };
    await this.sendText(chatId, fa.telegram.historyTitle, keyboard);
  }

  // فقط دامپ متنی آخرین رویدادها — هیچ state ای عوض نمی‌شود، پس ادامه‌دادن از این مسیر
  // ممکن نیست (تصمیم سند: فقط نمایش)؛ پیام بعدی مشتری همچنان به resolveActiveConversation
  // (مکالمه‌ی واقعاً فعال) می‌رود، نه به این مکالمه‌ی آرشیوشده
  private async handleHistorySelect(
    chatId: string,
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { store: true, customer: true },
    });
    const belongsToChat =
      conversation?.customer.channel === 'TELEGRAM' &&
      conversation.customer.telegramChatId === chatId;
    if (!conversation || !belongsToChat) {
      await this.sendText(chatId, fa.telegram.historyNotFound);
      return;
    }

    const events = await this.prisma.conversationEvent.findMany({
      where: {
        conversationId,
        type: { in: ['CUSTOMER_MESSAGE', 'AGENT_REPLY', 'SELLER_MESSAGE'] },
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    const entry = buildHistoryEntry(conversation, conversation.store.name);
    const lines = events
      .map((e) => {
        const text = (e.payload as { text?: string })?.text;
        if (!text) return null;
        const label =
          e.type === 'CUSTOMER_MESSAGE'
            ? fa.telegram.historyCustomerLabel
            : fa.telegram.historyAgentLabel;
        return `${label}: ${text}`;
      })
      .filter((l): l is string => !!l);

    const header = fa.telegram.historyTranscriptHeader(
      conversation.store.name,
      fa.telegram.historyStatusLabels[entry.status],
    );
    await this.sendText(chatId, [header, ...lines].join('\n'));
  }

  private async handlePhoto(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const conversation = await this.resolveActiveConversation(chatId);
    if (!conversation) return;

    // فیدبک کاربر — قبلاً این شرط هر عکسی را وقتی مکالمه muted بود (بعد از رد سفارش/
    // HANDOFF_HUMAN، یعنی «حالت همکار») بی‌صدا دور می‌ریخت: نه دانلود می‌شد، نه
    // ConversationEvent‌ای ساخته می‌شد — پس در تب «نیاز به توجه»ی پنل فروشنده هم هرگز دیده
    // نمی‌شد. دقیقاً همان مسیر submitImageMessage کانال وب (sales-agent.service.ts) اینجا هم
    // باید اجرا شود تا هر دو کانال یکسان رفتار کنند.
    if (conversation.isMutedForHuman) {
      const mutedPhotos = message.photo ?? [];
      const mutedLargest = mutedPhotos[mutedPhotos.length - 1];
      if (!mutedLargest) return;
      const mutedBuffer = await this.downloadFile(mutedLargest.file_id);
      const imageKey = await this.storage.uploadImage(
        mutedBuffer,
        'jpg',
        conversation.id,
      );
      const reattachedToOrder = await reattachReceiptIfOrderOpen(
        this.prisma,
        conversation.id,
        imageKey,
      );
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'CUSTOMER_MESSAGE',
          payload: {
            imageKey,
            ...(reattachedToOrder ? { reattachedToOrder } : {}),
          },
        },
      });
      return;
    }

    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۱ بند ۱ — قبلاً هر عکسی (حتی وقتی
    // مشتری فقط عکس یک محصول/اسکرین‌شات می‌فرستد، نه رسید) بدون قید و شرط به
    // handleReceiptUpload می‌رفت و جواب گمراه‌کننده‌ی «سفارشی در انتظار پرداخت پیدا نکردم»
    // می‌گرفت؛ این چک هم آن پیام را با یک پیام صادقانه عوض می‌کند، هم آپلود بی‌فایده‌ی عکس
    // به storage را قبل از آن متوقف می‌کند. engine.handleReceiptUpload همچنان خودش هم این
    // شرط را چک می‌کند (defense-in-depth)، اینجا فقط زودتر و ارزان‌تر رد می‌شود
    if (conversation.currentState !== 'AWAITING_PAYMENT') {
      await this.sendText(chatId, fa.telegram.photoNotExpected);
      return;
    }

    const photos = message.photo ?? [];
    const largest = photos[photos.length - 1]; // تلگرام رزولوشن‌ها را صعودی می‌فرستد
    if (!largest) return;

    const buffer = await this.downloadFile(largest.file_id);
    const key = await this.storage.uploadImage(buffer, 'jpg', conversation.id);
    const result = await this.withTypingIndicator(chatId, () =>
      this.engine.handleReceiptUpload(conversation, key),
    );
    await this.sendEngineResult(chatId, result);
  }

  // docs/PRD-sales-agent-voice.md بخش ۲.۳ — تلگرام voice note (OGG/Opus) → همان
  // MediaTranscodeService.extractAudio که caption-transcribe.processor.ts استفاده می‌کند
  // (تبدیل به mp3 واقعی، نه فقط تغییر پسوند) → AsrService.transcribeWithFallback موجود؛ متن
  // خروجی دقیقاً مثل این‌که مشتری تایپ کرده باشد وارد engine.handleMessage می‌شود
  //
  // فیدبک: قبلاً وقتی ASR متن خالی برمی‌گرداند یا هر مرحله (دانلود/ترنسکود/ASR) throw می‌کرد،
  // تابع بی‌صدا return می‌شد — catch عمومی handleUpdate فقط سرور را لاگ می‌کند و هیچ پاسخی به
  // مشتری نمی‌رسد، یعنی از دید مشتری بات اصلاً جواب نمی‌داد. هر دو مسیر حالا یک پیام واقعی
  // برمی‌گردانند.
  private async handleVoice(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const conversation = await this.resolveActiveConversation(chatId);
    if (!conversation || conversation.isMutedForHuman || !message.voice) return;

    try {
      await this.withTypingIndicator(chatId, async () => {
        const oggBuffer = await this.downloadFile(message.voice!.file_id);
        this.logger.log(
          `handleVoice conversation=${conversation.id} ogg duration=${message.voice!.duration}s mimeType=${message.voice!.mime_type ?? 'n/a'} bytes=${oggBuffer.length}`,
        );
        const mp3Buffer = await this.mediaTranscode.extractAudio(
          oggBuffer,
          'ogg',
        );
        this.logger.log(
          `handleVoice conversation=${conversation.id} extractAudio ogg→mp3 bytes=${oggBuffer.length}→${mp3Buffer.length}`,
        );
        const products = await this.prisma.product.findMany({
          where: { storeId: conversation.storeId },
          select: { name: true },
          take: 8,
        });
        const vocabHint = buildAsrVocabHint(
          conversation.store.name,
          products.map((p) => p.name),
        );
        const transcript = await this.asr.transcribeWithFallback(
          mp3Buffer,
          this.aiProvider.sharedApiKey,
          'fa',
          vocabHint,
          VOICE_MESSAGE_ASR_CHAIN,
          false,
        );
        this.logger.log(
          `handleVoice conversation=${conversation.id} transcribed model=${transcript.modelUsed} text="${transcript.text.slice(0, 200)}"`,
        );
        // فیدبک کاربر ۱۴۰۵/۰۷/۱۸ — هزینه‌ی واقعی ASR (قبلاً هیچ‌جا لاگ/کسر نمی‌شد)
        await this.creditService.logAsrUsage({
          storeId: conversation.storeId,
          customerId: conversation.customerId,
          conversationId: conversation.id,
          billingMode: conversation.billingMode,
          model: transcript.modelUsed,
          usdCost: transcript.costUsd,
        });
        if (!transcript.text.trim()) {
          await this.sendText(chatId, fa.telegram.voiceNotUnderstood);
          return;
        }

        const result = await this.engine.handleMessage(
          conversation,
          transcript.text,
        );
        await this.sendEngineResult(chatId, result);
      });
    } catch (err) {
      this.logger.error(
        `handleVoice failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.sendText(chatId, fa.telegram.voiceNotUnderstood);
    }
  }

  private async logCustomerMessage(
    conversationId: string,
    text: string,
  ): Promise<void> {
    await this.prisma.conversationEvent.create({
      data: { conversationId, type: 'CUSTOMER_MESSAGE', payload: { text } },
    });
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — کد گفتگو داخل متن پیام force_reply (نه در
  // callback_data) کدگذاری شده، چون force_reply جایگزین inline keyboard پیام می‌شود؛ وقتی
  // فروشنده جواب می‌دهد، تلگرام همان پیام اصلی را در reply_to_message برمی‌گرداند
  private static readonly SELLER_REPLY_REF_REGEX =
    /کد گفتگو: ([0-9a-fA-F-]{36})/;

  private extractSellerReplyRef(message: TelegramMessage): string | null {
    const promptText = message.reply_to_message?.text;
    if (!promptText) return null;
    const match = promptText.match(TelegramService.SELLER_REPLY_REF_REGEX);
    return match ? match[1] : null;
  }

  // فیدبک کاربر — عیناً الگوی SELLER_REPLY_REF_REGEX بالا، برای گرفتن دلیل رد سفارش؛ متن
  // prompt جدا است (کد سفارش رد: ...) تا با force_reply جواب‌به‌مشتری اشتباه گرفته نشود
  private static readonly SELLER_REJECT_REASON_REF_REGEX =
    /کد سفارش رد: ([0-9a-fA-F-]{36})/;

  private extractSellerRejectReasonRef(
    message: TelegramMessage,
  ): string | null {
    const promptText = message.reply_to_message?.text;
    if (!promptText) return null;
    const match = promptText.match(
      TelegramService.SELLER_REJECT_REASON_REF_REGEX,
    );
    return match ? match[1] : null;
  }

  private async handleSellerReplyButton(
    chatId: string,
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { store: true },
    });
    if (!conversation || conversation.store.ownerTelegramChatId !== chatId)
      return;
    await this.sendForceReply(
      chatId,
      fa.telegram.sellerReplyPrompt(conversationId),
    );
  }

  private async handleSellerReplyMessage(
    message: TelegramMessage,
    conversationId: string,
  ): Promise<void> {
    const chatId = String(message.chat.id);
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { store: true },
    });
    if (!conversation || conversation.store.ownerTelegramChatId !== chatId)
      return;
    const text = message.text?.trim();
    if (!text) return;
    await this.storeService.sendSellerMessage(
      conversation.store.sellerId,
      conversation.storeId,
      conversation.id,
      text,
    );
    await this.sendText(chatId, fa.telegram.sellerReplySent);
  }

  private async handleSellerOrderDecision(
    chatId: string,
    data: string,
  ): Promise<void> {
    const approve = data.startsWith('sap:');
    const orderId = data.slice(4);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { conversation: { include: { store: true } } },
    });
    if (!order || order.conversation.store.ownerTelegramChatId !== chatId)
      return;
    const store = order.conversation.store;
    if (approve) {
      await this.storeService.approveOrder(store.sellerId, store.id, orderId);
      await this.sendText(chatId, fa.telegram.orderApprovedFromTelegram);
    } else {
      // فیدبک کاربر — رد سفارش دیگر فوری انجام نمی‌شود؛ اول دلیل رد با force_reply گرفته
      // می‌شود (handleSellerRejectReasonMessage پایین)، چون خریدار باید دلیل رو توی چت ببیند
      await this.sendForceReply(
        chatId,
        fa.telegram.sellerRejectReasonPrompt(orderId),
      );
    }
  }

  private async handleSellerRejectReasonMessage(
    message: TelegramMessage,
    orderId: string,
  ): Promise<void> {
    const chatId = String(message.chat.id);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { conversation: { include: { store: true } } },
    });
    if (!order || order.conversation.store.ownerTelegramChatId !== chatId)
      return;
    const store = order.conversation.store;
    const text = message.text?.trim();
    const reason =
      !text || text === fa.telegram.sellerRejectReasonSkipKeyword
        ? undefined
        : text;
    await this.storeService.rejectOrder(
      store.sellerId,
      store.id,
      orderId,
      reason,
    );
    await this.sendText(chatId, fa.telegram.orderRejectedFromTelegram);
  }

  // docs/PRD-bulk-product-import-from-document.md — عیناً معادل تلگرامیِ BulkProductImportSheet
  // پنل وب: فروشنده یک PDF/Word به چت شخصی‌اش (owner chat) می‌فرستد → استخراج محصولات →
  // خلاصه با دکمه‌ی تایید ارسال می‌شود → فقط با زدن دکمه چیزی واقعاً ساخته/آپدیت می‌شود.
  // ساده‌سازی عمدی نسبت به پنل وب: اگر یک chat به چند فروشگاه وصل بود (نادر)، این مسیر
  // پشتیبانی نمی‌شود — فروشنده به پنل وب ارجاع داده می‌شود، چون نمی‌شود بدون پرسیدن حدس زد
  // فایل برای کدام فروشگاه است.
  private async handleSellerBulkImportDocument(
    message: TelegramMessage,
  ): Promise<void> {
    const chatId = String(message.chat.id);
    const doc = message.document!;
    const stores = await this.prisma.store.findMany({
      where: { ownerTelegramChatId: chatId },
    });
    if (stores.length === 0) return; // چت مالک هیچ فروشگاهی نیست — بی‌صدا نادیده (رفتار قبلی)
    if (stores.length > 1) {
      await this.sendText(chatId, fa.telegram.bulkImportMultiStoreUnsupported);
      return;
    }
    if (!doc.file_name) {
      await this.sendText(chatId, fa.telegram.bulkImportError);
      return;
    }
    if ((doc.file_size ?? 0) > BULK_IMPORT_MAX_FILE_BYTES) {
      await this.sendText(chatId, fa.telegram.bulkImportFileTooLarge);
      return;
    }

    const store = stores[0];
    await this.sendText(chatId, fa.telegram.bulkImportProcessing);
    try {
      const buffer = await this.downloadFile(doc.file_id);
      const result = await this.storeKbService.extractProductsFromFile(
        store.sellerId,
        store.id,
        { buffer, originalname: doc.file_name },
      );
      await this.presentBulkImportResult(chatId, store, result);
    } catch (err) {
      this.logger.error(
        `handleSellerBulkImportDocument failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.sendText(chatId, fa.telegram.bulkImportError);
    }
  }

  // همان بالا، برای پیام صوتی روی چت شخصی فروشنده؛ false برمی‌گرداند اگر این چت مالک هیچ
  // فروشگاهی نبود تا caller به مسیر معمول خریدار (handleVoice) برگردد
  private async trySellerBulkImportVoice(
    message: TelegramMessage,
  ): Promise<boolean> {
    const chatId = String(message.chat.id);
    const stores = await this.prisma.store.findMany({
      where: { ownerTelegramChatId: chatId },
    });
    if (stores.length === 0) return false;
    if (stores.length > 1) {
      await this.sendText(chatId, fa.telegram.bulkImportMultiStoreUnsupported);
      return true;
    }

    const store = stores[0];
    await this.sendText(chatId, fa.telegram.bulkImportTranscribing);
    try {
      const oggBuffer = await this.downloadFile(message.voice!.file_id);
      const mp3Buffer = await this.mediaTranscode.extractAudio(
        oggBuffer,
        'ogg',
      );
      const transcript = await this.asr.transcribeWithFallback(
        mp3Buffer,
        this.aiProvider.sharedApiKey,
        'fa',
        undefined,
        VOICE_MESSAGE_ASR_CHAIN,
        false,
      );
      const result = await this.storeKbService.extractProductsFromText(
        store.sellerId,
        store.id,
        transcript.text,
      );
      await this.presentBulkImportResult(chatId, store, result);
    } catch (err) {
      this.logger.error(
        `trySellerBulkImportVoice failed: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.sendText(chatId, fa.telegram.bulkImportError);
    }
    return true;
  }

  // ردیف‌های ایجاد بدون basePrice همین‌جا کنار گذاشته می‌شوند (نه موقع اعمال) — چون تلگرام
  // برخلاف پنل وب امکان ویرایش فیلد به فیلد ندارد؛ هرگز قیمتی حدس زده نمی‌شود، فقط آن مورد
  // از این دسته رد می‌شود و صریحاً در پیام اعلام می‌شود
  private async presentBulkImportResult(
    chatId: string,
    store: Store,
    result: ExtractProductsResult,
  ): Promise<void> {
    if (result.items.length === 0) {
      await this.sendText(chatId, fa.telegram.bulkImportEmpty);
      return;
    }
    const applicable = result.items.filter(
      (i) => i.action === 'update' || typeof i.basePrice === 'number',
    );
    const skipped = result.items.length - applicable.length;
    if (applicable.length === 0) {
      await this.sendText(chatId, fa.telegram.bulkImportAllMissingPrice);
      return;
    }

    const token = randomUUID().replace(/-/g, '');
    this.pendingBulkImports.set(token, {
      chatId,
      storeId: store.id,
      sellerId: store.sellerId,
      items: applicable,
      createdAt: Date.now(),
    });

    const lines = applicable.map((item, i) => {
      const label =
        item.action === 'update'
          ? fa.telegram.bulkImportLineUpdate(
              item.matchedProductName || item.name,
            )
          : fa.telegram.bulkImportLineCreate(item.name);
      const price =
        item.basePrice !== undefined
          ? fa.telegram.bulkImportLinePrice(item.basePrice)
          : '';
      return `${i + 1}. ${label}${price}`;
    });
    const assumptionsBlock = result.assumptions.length
      ? `\n\n${fa.telegram.bulkImportAssumptionsTitle}\n${result.assumptions.map((a) => `• ${a}`).join('\n')}`
      : '';
    const skippedNote =
      skipped > 0 ? `\n\n${fa.telegram.bulkImportSkippedNote(skipped)}` : '';

    const keyboard: TelegramInlineKeyboard = {
      inline_keyboard: [
        [
          {
            text: fa.telegram.bulkImportConfirmButton(applicable.length),
            callback_data: `bpi:${token}`,
          },
        ],
      ],
    };
    await this.sendText(
      chatId,
      `${fa.telegram.bulkImportReviewTitle(applicable.length)}\n\n${lines.join('\n')}${assumptionsBlock}${skippedNote}`,
      keyboard,
    );
  }

  private async handleBulkImportConfirm(
    chatId: string,
    token: string,
  ): Promise<void> {
    const pending = this.pendingBulkImports.get(token);
    this.pendingBulkImports.delete(token);
    if (
      !pending ||
      pending.chatId !== chatId ||
      Date.now() - pending.createdAt > BULK_IMPORT_TTL_MS
    ) {
      await this.sendText(chatId, fa.telegram.bulkImportExpired);
      return;
    }

    let ok = 0;
    let fail = 0;
    for (const item of pending.items) {
      try {
        if (item.action === 'update' && item.matchedProductId) {
          await this.storeService.updateProduct(
            pending.sellerId,
            pending.storeId,
            item.matchedProductId,
            {
              name: item.name,
              description: item.description,
              basePrice: item.basePrice,
              stock: item.stock,
              code: item.code,
            },
          );
        } else {
          await this.storeService.createProduct(
            pending.sellerId,
            pending.storeId,
            {
              name: item.name,
              basePrice: item.basePrice ?? 0,
              description: item.description,
              stock: item.stock,
              code: item.code,
            },
          );
        }
        ok++;
      } catch (err) {
        this.logger.warn(
          `handleBulkImportConfirm item failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        fail++;
      }
    }
    await this.sendText(chatId, fa.telegram.bulkImportApplyResult(ok, fail));
  }

  // یک chat_id می‌تواند در چند فروشگاه مختلف مشتری باشد (یکتایی per-store، بخش ۲ سند) —
  // «فروشگاه فعال» یعنی مکالمه‌ای که آخرین‌بار در آن فعالیتی ثبت شده (آخرین /start یا پیام)
  private async resolveActiveConversation(
    chatId: string,
  ): Promise<ConversationWithStore | null> {
    const customers = await this.prisma.customer.findMany({
      where: { channel: 'TELEGRAM', telegramChatId: chatId },
      include: { salesConversations: { where: { archivedAt: null } } },
    });
    const withConv = customers
      .flatMap((c) => c.salesConversations)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    if (withConv.length === 0) return null;
    return this.loadConversation(withConv[0].id);
  }

  private loadConversation(
    conversationId: string,
  ): Promise<ConversationWithStore | null> {
    return this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { store: true },
    });
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۴ — قبلاً اینجا فقط یک URL (محصول/لوگو/ویدیو) ساخته می‌شد و به
  // sendPhoto/sendVideo/sendMediaGroup داده می‌شد تا خودِ تلگرام آن را fetch کند؛ دقیقاً همون
  // مشکل sendAudio بالا (بخش «ایران تلگرام را فیلتر می‌کند») برای عکس/ویدیوی محصول هم رخ
  // می‌داد — سرور تلگرام قادر به دانلود از بک‌اند میزبانی‌شده در ایران نبود، و چون callApi روی
  // پاسخ ناموفق throw نمی‌کند، این بی‌صدا هیچ عکس/ویدیویی نمی‌فرستاد. راه‌حل: همون الگوی
  // sendVoiceReadyBuffer — خودمان بایت فایل را از استوریج می‌گیریم و مستقیم آپلود می‌کنیم.
  private async loadImageMedia(
    key: string,
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const buffer = await this.storage.downloadImage(key);
      return { buffer, mimeType: mimeTypeForExt(key.split('.').pop() ?? '') };
    } catch (err) {
      this.logger.error(
        `telegram: failed to load image ${key} from storage: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  // ویدیوی محصول همیشه mp4 است (normalizeVideoForProviders در store.service.ts)
  private async loadVideoMedia(
    key: string,
  ): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
      const buffer = await this.storage.downloadImage(key);
      return { buffer, mimeType: 'video/mp4' };
    } catch (err) {
      this.logger.error(
        `telegram: failed to load video ${key} from storage: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  // یک عکس/ویدیوی تک از استوریج نخواندنی (مثلاً فایل پاک‌شده‌ی قدیمی) نباید کل کارت محصول را
  // بترکاند — همین‌جا حذف می‌شود، نه این‌که کل پیام fail شود
  private async loadMediaItems(
    keys: { type: 'photo' | 'video'; key: string }[],
  ): Promise<LoadedMediaItem[]> {
    const loaded = await Promise.all(
      keys.map(async ({ type, key }) => {
        const media =
          type === 'video'
            ? await this.loadVideoMedia(key)
            : await this.loadImageMedia(key);
        return media ? { type, filename: key, ...media } : null;
      }),
    );
    return loaded.filter((m): m is LoadedMediaItem => !!m);
  }

  private async sendEngineResult(
    chatId: string,
    result: EngineResult,
  ): Promise<void> {
    if (result.reply) await this.sendText(chatId, result.reply);
    for (const block of result.uiBlocks) {
      await this.sendUiBlock(chatId, block);
    }
  }

  private async sendUiBlock(chatId: string, block: UiBlock): Promise<void> {
    switch (block.type) {
      case 'PRODUCT_CARD':
        for (const p of block.products) {
          // عمداً بدون تعداد موجودی — فروشنده نمی‌خواهد رقم واقعی به خریدار نشان داده شود
          const caption = `${p.name}\n${p.basePrice.toLocaleString('fa-IR')} تومان${p.stock === 0 ? ' — ناموجود' : ''}`;
          const keyboard: TelegramInlineKeyboard = {
            inline_keyboard: [
              [{ text: '🛒 افزودن به سبد', callback_data: `ac:${p.id}` }],
            ],
          };
          // docs/PRD-product-video.md بخش ۴ — ویدیو(ها) قبل از عکس‌ها (تصمیم ترتیب‌نمایش)،
          // سقف ۱۰ آیتم (معادل سقف بومی sendMediaGroup تلگرام)
          const mediaKeys: { type: 'photo' | 'video'; key: string }[] = [
            ...p.videos.map((v) => ({ type: 'video' as const, key: v.key })),
            ...p.images.map((key) => ({ type: 'photo' as const, key })),
          ].slice(0, 10);
          const mediaItems = await this.loadMediaItems(mediaKeys);

          if (mediaItems.length >= 2) {
            // تلگرام sendMediaGroup هیچ reply_markup قبول نمی‌کند، پس کپشن+دکمه جدا می‌رود
            const groupResult = (await this.sendMediaGroupBuffer(
              chatId,
              mediaItems,
            )) as { ok?: boolean } | null;
            if (!groupResult?.ok) {
              this.logger.error(
                `telegram sendMediaGroup failed for product=${p.id}`,
              );
            }
            await this.sendText(chatId, caption, keyboard);
          } else if (mediaItems[0]?.type === 'photo') {
            // fallback به متن اگر sendPhoto شکست بخورد (مثلاً عکس در دسترس نباشد) — قبلاً
            // اینجا هیچ fallback نبود، پس یک sendPhoto ناموفق کل کارت محصول (عکس + دکمه‌ی
            // افزودن به سبد) را بی‌صدا حذف می‌کرد، چون callApi روی پاسخ ناموفق throw نمی‌کند
            const photo = mediaItems[0];
            const photoResult = (await this.sendPhotoBuffer(
              chatId,
              photo.buffer,
              photo.filename,
              photo.mimeType,
              caption,
              keyboard,
            )) as { ok?: boolean } | null;
            if (!photoResult?.ok) {
              await this.sendText(chatId, caption, keyboard);
            }
          } else if (mediaItems[0]?.type === 'video') {
            // تلگرام sendVideo کپشن/دکمه قبول نمی‌کند، پس جدا فرستاده می‌شود
            const video = mediaItems[0];
            const videoResult = (await this.sendVideoBuffer(
              chatId,
              video.buffer,
              video.filename,
            )) as { ok?: boolean } | null;
            if (!videoResult?.ok) {
              this.logger.error(
                `telegram sendVideo failed for product=${p.id}`,
              );
            }
            await this.sendText(chatId, caption, keyboard);
          } else {
            await this.sendText(chatId, caption, keyboard);
          }
        }
        return;
      // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۳ — برخلاف PRODUCT_CARD که فقط
      // images[0] می‌فرستد، همه‌ی عکس‌ها/ویدیوها را carousel-طور می‌فرستد (وقتی مشتری صریح
      // عکس بیشتر خواسته). docs/PRD-product-video.md بخش ۴ — ویدیو(ها) اول، بعد عکس‌ها
      case 'PRODUCT_PHOTOS': {
        const photoKeys: { type: 'photo' | 'video'; key: string }[] = [
          ...block.videos.map((v) => ({ type: 'video' as const, key: v.key })),
          ...block.images.map((key) => ({ type: 'photo' as const, key })),
        ].slice(0, 10);
        const photosMedia = await this.loadMediaItems(photoKeys);
        if (photosMedia.length >= 2) {
          await this.sendMediaGroupBuffer(chatId, photosMedia);
        } else if (photosMedia[0]?.type === 'video') {
          await this.sendVideoBuffer(
            chatId,
            photosMedia[0].buffer,
            photosMedia[0].filename,
          );
        } else if (photosMedia[0]) {
          await this.sendPhotoBuffer(
            chatId,
            photosMedia[0].buffer,
            photosMedia[0].filename,
            photosMedia[0].mimeType,
            block.productName,
          );
        }
        return;
      }
      case 'CART_SUMMARY': {
        const lines = block.items.map(
          (i) =>
            `${i.name} × ${i.qty.toLocaleString('fa-IR')} = ${(i.unitPrice * i.qty).toLocaleString('fa-IR')} تومان`,
        );
        const text = `${lines.join('\n')}\n\nجمع کل: ${block.total.toLocaleString('fa-IR')} تومان`;
        await this.sendText(chatId, text, {
          inline_keyboard: [
            [{ text: '✅ تایید و پرداخت', callback_data: 'cc' }],
          ],
        });
        return;
      }
      case 'PAYMENT_INSTRUCTIONS': {
        const text = `شماره کارت: ${block.cardNumber}\nبه نام: ${block.ownerName}\nمبلغ: ${block.amount.toLocaleString('fa-IR')} تومان\n\nلطفاً عکس رسید رو همینجا بفرست`;
        await this.sendText(chatId, text);
        return;
      }
      case 'ORDER_STATUS':
        await this.sendText(chatId, `وضعیت سفارش: ${block.status}`);
        return;
      // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ + docs/PRD-buyer-saved-addresses.md
      case 'ADDRESS_PROMPT': {
        if (block.mode === 'CHOOSE_SAVED') {
          const keyboard: TelegramInlineKeyboard = {
            inline_keyboard: [
              ...(block.addresses ?? []).map((a) => [
                { text: a.summary, callback_data: `sa:${a.id}` },
              ]),
              [{ text: fa.salesAgent.addressNewOption, callback_data: 'na' }],
            ],
          };
          await this.sendText(
            chatId,
            fa.salesAgent.addressChooseSavedPrompt,
            keyboard,
          );
        } else if (block.mode === 'CHOOSE_PROVINCE') {
          const provinces = block.provinces ?? [];
          const rows: TelegramInlineKeyboard['inline_keyboard'] = [];
          for (let i = 0; i < provinces.length; i += 3) {
            rows.push(
              provinces
                .slice(i, i + 3)
                .map((p) => ({ text: p, callback_data: `pv:${p}` })),
            );
          }
          await this.sendText(chatId, fa.salesAgent.addressAskProvince, {
            inline_keyboard: rows,
          });
        } else if (block.mode === 'CONFIRM') {
          await this.sendText(chatId, block.summary ?? '', {
            inline_keyboard: [
              [
                {
                  text: fa.salesAgent.addressConfirmButton,
                  callback_data: 'ca',
                },
                { text: fa.salesAgent.addressEditButton, callback_data: 'ea' },
              ],
            ],
          });
        } else {
          await this.sendText(chatId, fa.salesAgent.addressSavePrompt, {
            inline_keyboard: [
              [
                {
                  text: fa.salesAgent.addressSaveYesButton,
                  callback_data: 'sva',
                },
                {
                  text: fa.salesAgent.addressSaveNoButton,
                  callback_data: 'nsa',
                },
              ],
            ],
          });
        }
        return;
      }
      // docs/PRD-product-display-focus-and-variations.md §۴.۲ — عیناً سبک CHOOSE_PROVINCE بالا:
      // چیپ‌چین ۳تایی؛ callback_data همیشه مقدار/UUID کوتاه است (هیچ‌وقت لیبل فارسی ترکیب)
      case 'VARIANT_PROMPT': {
        const rows: TelegramInlineKeyboard['inline_keyboard'] = [];
        for (let i = 0; i < block.values.length; i += 3) {
          rows.push(
            block.values
              .slice(i, i + 3)
              .map((v) => ({ text: v.label, callback_data: `vv:${v.value}` })),
          );
        }
        const text =
          block.mode === 'ALTERNATIVES'
            ? fa.salesAgent.variantOutOfStockAlternatives
            : fa.salesAgent.variantAskOption(block.optionName ?? '');
        await this.sendText(chatId, text, { inline_keyboard: rows });
        return;
      }
      case 'NONE':
        return;
    }
  }

  private async callApi(
    method: string,
    body: Record<string, unknown> | FormData,
  ): Promise<unknown> {
    if (!this.botToken) {
      // قبلاً اینجا بی‌صدا null برمی‌گشت — یعنی اگر TELEGRAM_BOT_TOKEN روی این پراسس ست
      // نشده باشد، هیچ پیامی هرگز ارسال نمی‌شد و هیچ‌جا هم لاگ نمی‌شد (دقیقاً همون الگوی
      // «deploy لود نشده» که سمت relay هم افتاده بود).
      this.logger.warn(
        `telegram ${method} skipped: TELEGRAM_BOT_TOKEN not set`,
      );
      return null;
    }
    // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — عیناً همون الگوی دوگانه‌ی TelegramApiClientService
    // (sendPhotoBuffer)؛ برای sendVoiceReadyBuffer لازم است چون body اینجا بایت فایل است، نه JSON
    const isForm = body instanceof FormData;
    let res: Response;
    try {
      res = await fetch(`${this.apiBaseUrl}/bot${this.botToken}/${method}`, {
        method: 'POST',
        headers: isForm
          ? this.relayHeaders
          : { 'Content-Type': 'application/json', ...this.relayHeaders },
        body: isForm ? body : JSON.stringify(body),
      });
    } catch (err) {
      this.logger.error(
        `telegram ${method} network error calling ${this.apiBaseUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
    if (!res.ok) {
      // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — قبلاً body درخواست (شامل خودِ URL فایل، برای sendAudio/
      // sendPhoto/sendVideo) لاگ نمی‌شد؛ برای دیباگ «failed to get HTTP URL content» باید
      // دقیقاً همون URLـی که به تلگرام داده شده دیده شود، نه فقط کد خطا (برای FormData معنی‌دار
      // نیست، JSON.stringify آن {} می‌دهد)
      this.logger.error(
        `telegram ${method} failed: ${res.status} ${await res.text()}${isForm ? '' : ` — body=${JSON.stringify(body)}`}`,
      );
    } else {
      this.logger.debug(`telegram ${method} ok`);
    }
    return res.json().catch(() => null);
  }

  private sendText(chatId: string, text: string, keyboard?: TelegramKeyboard) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  // فیدبک: نوبت FULL_AGENT می‌تواند ۵-۱۵ ثانیه طول بکشد (طبق تست‌های eval واقعی) و بدون هیچ
  // نشانه‌ای مشتری فکر می‌کند بات جواب نمی‌دهد. «در حال تایپ» تلگرام بعد از ~۵ ثانیه خودش محو
  // می‌شود، پس برای نوبت‌های طولانی‌تر باید هر چند ثانیه دوباره فرستاده شود تا کار fn تمام شود.
  private async withTypingIndicator<T>(
    chatId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const sendTyping = () =>
      void this.callApi('sendChatAction', {
        chat_id: chatId,
        action: 'typing',
      });
    sendTyping();
    const interval = setInterval(sendTyping, 4000);
    try {
      return await fn();
    } finally {
      clearInterval(interval);
    }
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — تلگرام reply_to_message را روی پیام بعدی
  // فروشنده می‌گذارد؛ conversationId از متن همین پیام استخراج می‌شود (بخش extractSellerReplyRef)
  private sendForceReply(chatId: string, text: string) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { force_reply: true },
    });
  }

  // عیناً الگوی sendVoiceReadyBuffer — بایت عکس مستقیم آپلود می‌شود، نه URL (توضیح بالا)
  private sendPhotoBuffer(
    chatId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string,
    caption: string,
    keyboard?: TelegramInlineKeyboard,
  ) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    if (keyboard) form.append('reply_markup', JSON.stringify(keyboard));
    form.append(
      'photo',
      new Blob([new Uint8Array(buffer)], { type: mimeType }),
      filename,
    );
    return this.callApi('sendPhoto', form);
  }

  // docs/PRD-product-video.md — ویدیوی معرفی محصول؛ همیشه mp4 است (normalizeVideoForProviders
  // در store.service.ts)
  private sendVideoBuffer(chatId: string, buffer: Buffer, filename: string) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append(
      'video',
      new Blob([new Uint8Array(buffer)], { type: 'video/mp4' }),
      filename,
    );
    return this.callApi('sendVideo', form);
  }

  // docs/PRD-product-video.md بخش ۴ — carousel بومی تلگرام برای چندویدیو/چندعکس یک محصول؛
  // برخلاف sendPhoto/sendVideo، تلگرام روی sendMediaGroup هیچ reply_markup (دکمه) قبول
  // نمی‌کند، پس دکمه‌ی «افزودن به سبد» باید در یک sendText جدا بعد از این فرستاده شود.
  // برخلاف sendPhoto/sendVideo تکی، تلگرام برای فایل‌های آپلودی در sendMediaGroup هر آیتم را
  // با media:'attach://<name>' در آرایه‌ی JSON ارجاع می‌دهد و فایل واقعی را جدا، با همون
  // نام فیلد، به فرم multipart می‌چسباند
  private sendMediaGroupBuffer(chatId: string, items: LoadedMediaItem[]) {
    const form = new FormData();
    form.append('chat_id', chatId);
    const media = items.map((item, i) => ({
      type: item.type,
      media: `attach://file${i}`,
    }));
    form.append('media', JSON.stringify(media));
    items.forEach((item, i) => {
      form.append(
        `file${i}`,
        new Blob([new Uint8Array(item.buffer)], { type: item.mimeType }),
        item.filename,
      );
    });
    return this.callApi('sendMediaGroup', form);
  }

  private answerCallbackQuery(callbackQueryId: string) {
    return this.callApi('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
    });
  }

  private async downloadFile(fileId: string): Promise<Buffer> {
    const info = (await this.callApi('getFile', { file_id: fileId })) as {
      result?: { file_path?: string };
    } | null;
    const filePath = info?.result?.file_path;
    if (!filePath) throw new Error('telegram getFile: no file_path');
    const res = await fetch(
      `${this.apiBaseUrl}/file/bot${this.botToken}/${filePath}`,
      { headers: this.relayHeaders },
    );
    // قبلاً اینجا res.ok چک نمی‌شد — اگر دانلود فایل شکست می‌خورد (۴۰۴/مشکل relay)، بدنه‌ی
    // خطا (معمولاً چند بایت متن/JSON) به‌جای صدای واقعی به ffmpeg/ASR می‌رسید؛ خروجی یا کرش
    // می‌کرد یا متن بی‌معنی/خالی تولید می‌شد، بدون این‌که هیچ‌جا مشخص شود دانلود اصلاً شکست خورده
    if (!res.ok) {
      throw new Error(
        `telegram file download failed: ${res.status} path=${filePath}`,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
