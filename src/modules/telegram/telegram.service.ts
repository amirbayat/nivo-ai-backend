import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import { AsrService } from '../../common/services/asr.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import {
  ConversationEngineService,
  type ConversationWithStore,
} from '../sales-agent/conversation-engine.service';
import { CreditService } from '../sales-agent/credit.service';
import { pickVariant } from '../sales-agent/model-variants';
import { buildAsrVocabHint } from '../sales-agent/asr-vocab-hint';
import type {
  EngineResult,
  SalesAction,
  UiBlock,
} from '../sales-agent/sales-agent.types';
import { fa } from '../../i18n/fa';
import type {
  TelegramCallbackQuery,
  TelegramInlineKeyboard,
  TelegramMessage,
  TelegramUpdate,
} from './telegram.types';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ConversationEngineService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly asr: AsrService,
    private readonly aiProvider: AiProviderService,
    private readonly creditService: CreditService,
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
  // وقتی وویس یک پاسخ آماده شد و مکالمه از کانال تلگرام است (تلگرام برخلاف وب پول‌کردن ندارد،
  // چون وبهوک push-based است؛ همین لحظه که وویس آماده شد مستقیم push می‌شود). عمداً sendAudio
  // (نه sendVoice بومی) چون sendVoice نیازمند OGG/Opus است و ترنسکود آن فعلاً خارج از این فاز
  // است (بخش ۱.۵ سند) — mp3 با sendAudio هم صدا را می‌رساند، فقط ظاهرش حباب صدای بومی نیست.
  async sendVoiceReady(chatId: string, audioUrl: string): Promise<void> {
    await this.callApi('sendAudio', { chat_id: chatId, audio: audioUrl });
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
      if (message.photo?.length) {
        await this.handlePhoto(message);
        return;
      }
      if (message.voice) {
        await this.handleVoice(message);
        return;
      }
      if (message.text) {
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
    const slug = message.text!.trim().split(/\s+/)[1];
    if (!slug) {
      await this.sendText(chatId, fa.telegram.startNeedsLink);
      return;
    }

    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store || store.status !== 'ACTIVE') {
      await this.sendText(chatId, fa.store.notFound);
      return;
    }

    const existing = await this.prisma.customer.findUnique({
      where: {
        storeId_telegramChatId: { storeId: store.id, telegramChatId: chatId },
      },
      include: { salesConversation: true },
    });

    let conversationId: string;
    if (existing?.salesConversation) {
      conversationId = existing.salesConversation.id;
    } else {
      // docs/PRD-seller-credit-billing.md — یک‌بار همین‌جا تعیین می‌شود، معادل startChat وب
      const billingMode = await this.creditService.decideBillingMode(store.id);
      const customer = await this.prisma.customer.create({
        data: {
          storeId: store.id,
          channel: 'TELEGRAM',
          telegramChatId: chatId,
          salesConversation: {
            create: {
              storeId: store.id,
              abVariant: pickVariant(),
              billingMode,
            },
          },
        },
        include: { salesConversation: true },
      });
      conversationId = customer.salesConversation!.id;
    }

    const conversation = await this.loadConversation(conversationId);
    if (!conversation) return;
    const result = await this.engine.startBrowse(conversation);
    await this.sendEngineResult(chatId, result);
  }

  private async handleText(message: TelegramMessage): Promise<void> {
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

  private async handleCallback(cq: TelegramCallbackQuery): Promise<void> {
    const chatId = cq.message ? String(cq.message.chat.id) : String(cq.from.id);
    await this.answerCallbackQuery(cq.id);

    const conversation = await this.resolveActiveConversation(chatId);
    if (!conversation) return;

    const data = cq.data ?? '';
    let action: SalesAction | null = null;
    if (data.startsWith('ac:'))
      action = { type: 'ADD_TO_CART', productId: data.slice(3) };
    else if (data === 'cc') action = { type: 'CONFIRM_CART' };
    if (!action) return;

    if (conversation.isMutedForHuman) return;
    const result = await this.engine.handleAction(conversation, action);
    await this.sendEngineResult(chatId, result);
  }

  private async handlePhoto(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const conversation = await this.resolveActiveConversation(chatId);
    if (!conversation || conversation.isMutedForHuman) return;

    const photos = message.photo ?? [];
    const largest = photos[photos.length - 1]; // تلگرام رزولوشن‌ها را صعودی می‌فرستد
    if (!largest) return;

    const buffer = await this.downloadFile(largest.file_id);
    const key = await this.storage.uploadImage(buffer, 'jpg', conversation.id);
    const result = await this.engine.handleReceiptUpload(conversation, key);
    await this.sendEngineResult(chatId, result);
  }

  // docs/PRD-sales-agent-voice.md بخش ۲.۳ — تلگرام voice note (OGG/Opus) → همان
  // MediaTranscodeService.extractAudio که caption-transcribe.processor.ts استفاده می‌کند
  // (تبدیل به mp3 واقعی، نه فقط تغییر پسوند) → AsrService.transcribeWithFallback موجود؛ متن
  // خروجی دقیقاً مثل این‌که مشتری تایپ کرده باشد وارد engine.handleMessage می‌شود
  private async handleVoice(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);
    const conversation = await this.resolveActiveConversation(chatId);
    if (!conversation || conversation.isMutedForHuman || !message.voice) return;

    const oggBuffer = await this.downloadFile(message.voice.file_id);
    const mp3Buffer = await this.mediaTranscode.extractAudio(oggBuffer, 'ogg');
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
    );
    if (!transcript.text.trim()) return;

    const result = await this.engine.handleMessage(
      conversation,
      transcript.text,
    );
    await this.sendEngineResult(chatId, result);
  }

  private async logCustomerMessage(
    conversationId: string,
    text: string,
  ): Promise<void> {
    await this.prisma.conversationEvent.create({
      data: { conversationId, type: 'CUSTOMER_MESSAGE', payload: { text } },
    });
  }

  // یک chat_id می‌تواند در چند فروشگاه مختلف مشتری باشد (یکتایی per-store، بخش ۲ سند) —
  // «فروشگاه فعال» یعنی مکالمه‌ای که آخرین‌بار در آن فعالیتی ثبت شده (آخرین /start یا پیام)
  private async resolveActiveConversation(
    chatId: string,
  ): Promise<ConversationWithStore | null> {
    const customers = await this.prisma.customer.findMany({
      where: { channel: 'TELEGRAM', telegramChatId: chatId },
      include: { salesConversation: true },
    });
    const withConv = customers
      .map((c) => c.salesConversation)
      .filter((c): c is NonNullable<typeof c> => !!c)
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

  private productImageUrl(productId: string, key: string): string {
    const apiUrl = this.config.get<string>('API_URL');
    // main.ts: app.setGlobalPrefix('api/v1') روی همه‌ی روت‌ها اعمال می‌شود، ولی API_URL
    // (طبق .env.example) فقط origin خالی است (بدون /api/v1) — بدون این پیشوند، تلگرام موقع
    // sendPhoto با 404 مواجه می‌شود و کل uiBlock (عکس + دکمه‌ی افزودن به سبد) بی‌صدا حذف
    // می‌شود، چون callApi روی پاسخ ناموفق throw نمی‌کند، فقط لاگ می‌کند
    return `${apiUrl}/api/v1/v2/products/${productId}/images/${key}`;
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
          // fallback به متن اگر sendPhoto شکست بخورد (مثلاً عکس در دسترس نباشد) — قبلاً
          // اینجا هیچ fallback نبود، پس یک sendPhoto ناموفق کل کارت محصول (عکس + دکمه‌ی
          // افزودن به سبد) را بی‌صدا حذف می‌کرد، چون callApi روی پاسخ ناموفق throw نمی‌کند
          const photoResult = p.images[0]
            ? ((await this.sendPhoto(
                chatId,
                this.productImageUrl(p.id, p.images[0]),
                caption,
                keyboard,
              )) as { ok?: boolean } | null)
            : null;
          if (!p.images[0] || !photoResult?.ok) {
            await this.sendText(chatId, caption, keyboard);
          }
        }
        return;
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
      case 'NONE':
        return;
    }
  }

  private async callApi(
    method: string,
    body: Record<string, unknown>,
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
    let res: Response;
    try {
      res = await fetch(`${this.apiBaseUrl}/bot${this.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.relayHeaders },
        body: JSON.stringify(body),
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
      this.logger.error(
        `telegram ${method} failed: ${res.status} ${await res.text()}`,
      );
    } else {
      this.logger.debug(`telegram ${method} ok`);
    }
    return res.json().catch(() => null);
  }

  private sendText(
    chatId: string,
    text: string,
    keyboard?: TelegramInlineKeyboard,
  ) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  private sendPhoto(
    chatId: string,
    photoUrl: string,
    caption: string,
    keyboard?: TelegramInlineKeyboard,
  ) {
    return this.callApi('sendPhoto', {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
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
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
