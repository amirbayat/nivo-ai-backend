import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TelegramKeyboard } from '../telegram/telegram.types';

// docs/PRD-seller-telegram-management-bot.md — کپی سبک TelegramApiClientService با env جدا
// (SELLER_BOT_*)؛ فایل جدا (نه تغییر سرویس موجود) تا هیچ ریسکی روی بات مشتری‌محور نباشد —
// توکن/وبهوک این بات کاملاً مستقل است
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [300, 800];

@Injectable()
export class SellerBotApiClientService {
  private readonly logger = new Logger(SellerBotApiClientService.name);
  private readonly botToken?: string;
  private readonly apiBaseUrl: string;
  private readonly relaySecret?: string;

  constructor(private readonly config: ConfigService) {
    this.botToken = this.config.get<string>('SELLER_BOT_TOKEN');
    this.apiBaseUrl =
      this.config.get<string>('SELLER_BOT_API_BASE_URL') ??
      'https://api.telegram.org';
    this.relaySecret = this.config.get<string>('SELLER_BOT_RELAY_SECRET');
    this.logger.log(
      `seller bot config: botToken=${this.botToken ? 'set' : 'MISSING'} apiBaseUrl=${this.apiBaseUrl} relaySecret=${
        this.relaySecret ? 'set' : 'not set (direct, dev only)'
      }`,
    );
  }

  private get relayHeaders(): Record<string, string> {
    return this.relaySecret ? { 'X-Relay-Secret': this.relaySecret } : {};
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — یک 502 bad_gateway از relay دیده شد (ارسال سفارش‌ها). این relay
  // خودش یک hop اضافه (outside-Iran) است که گاهی به api.telegram.org وصل‌شدنش گذرا (transient)
  // شکست می‌خورد؛ به‌جای شکست کامل پیام، چند بار با backoff کوتاه دوباره تلاش می‌کند
  private async callApi(
    method: string,
    body: Record<string, unknown> | FormData,
  ): Promise<unknown> {
    if (!this.botToken) {
      this.logger.warn(
        `seller bot ${method} skipped: SELLER_BOT_TOKEN not set`,
      );
      return null;
    }
    const isForm = body instanceof FormData;
    const url = `${this.apiBaseUrl}/bot${this.botToken}/${method}`;
    const init: RequestInit = {
      method: 'POST',
      headers: isForm
        ? this.relayHeaders
        : { 'Content-Type': 'application/json', ...this.relayHeaders },
      body: isForm ? body : JSON.stringify(body),
    };

    let lastError: unknown;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, init);
      } catch (err) {
        lastError = err;
        this.logger.error(
          `seller bot ${method} network error calling ${this.apiBaseUrl}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        if (attempt < RETRY_DELAYS_MS.length) {
          await this.sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw err;
      }
      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`seller bot ${method} failed: ${res.status} ${text}`);
        if (
          RETRYABLE_STATUS.has(res.status) &&
          attempt < RETRY_DELAYS_MS.length
        ) {
          await this.sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        return null;
      }
      return res.json().catch(() => null);
    }
    throw lastError;
  }

  sendText(chatId: string, text: string, keyboard?: TelegramKeyboard) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  sendForceReply(chatId: string, text: string) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { force_reply: true },
    });
  }

  // برخلاف sendText با URL، تلگرام مستقیم بایت عکس را می‌گیرد — لازم برای عکس رسید، چون
  // endpoint سرو رسید پشت JwtGuard+مالکیت است و سرور تلگرام نمی‌تواند آن را fetch کند
  // (عیناً الگوی TelegramApiClientService.sendPhotoBuffer)
  sendPhotoBuffer(
    chatId: string,
    buffer: Buffer,
    filename: string,
    mimeType: string,
    caption: string,
    keyboard?: TelegramKeyboard,
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

  answerCallbackQuery(callbackQueryId: string, text?: string) {
    return this.callApi('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  removeReplyKeyboard(chatId: string, text: string) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { remove_keyboard: true },
    });
  }
}
