import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TelegramInlineKeyboard } from './telegram.types';

// docs/PRD-telegram-bot-channel.md بخش ۹.۱ — نسخه‌ی سبک و مستقل از callApi/sendText/sendPhoto
// موجود در TelegramService، چون ConversationEngineService/StoreService (برای پوش اعلان
// handoff/رسید به فروشنده، و پیام فروشنده به مشتری‌ای که کانالش تلگرام است) نمی‌توانند
// مستقیم TelegramService را import کنند — TelegramModule خودش SalesAgentModule (که
// StoreModule را import می‌کند) را import کرده، پس مسیر برعکس چرخه می‌سازد. این سرویس
// هیچ وابستگی‌ای به ماژول‌های sales-agent/store ندارد، پس هرکدام می‌توانند مستقیم importش کنند.
@Injectable()
export class TelegramApiClientService {
  private readonly logger = new Logger(TelegramApiClientService.name);
  private readonly botToken?: string;
  private readonly apiBaseUrl: string;
  private readonly relaySecret?: string;

  constructor(private readonly config: ConfigService) {
    this.botToken = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    this.apiBaseUrl =
      this.config.get<string>('TELEGRAM_API_BASE_URL') ??
      'https://api.telegram.org';
    this.relaySecret = this.config.get<string>('TELEGRAM_RELAY_SECRET');
  }

  private get relayHeaders(): Record<string, string> {
    return this.relaySecret ? { 'X-Relay-Secret': this.relaySecret } : {};
  }

  private async callApi(
    method: string,
    body: Record<string, unknown> | FormData,
  ): Promise<unknown> {
    if (!this.botToken) {
      this.logger.warn(
        `telegram ${method} skipped: TELEGRAM_BOT_TOKEN not set`,
      );
      return null;
    }
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
      this.logger.error(
        `telegram ${method} failed: ${res.status} ${await res.text()}`,
      );
    }
    return res.json().catch(() => null);
  }

  sendText(chatId: string, text: string, keyboard?: TelegramInlineKeyboard) {
    return this.callApi('sendMessage', {
      chat_id: chatId,
      text,
      ...(keyboard ? { reply_markup: keyboard } : {}),
    });
  }

  sendPhotoUrl(
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

  // برخلاف sendPhotoUrl، تلگرام مستقیم بایت عکس را می‌گیرد — لازم برای عکس رسید، چون
  // endpoint سرو رسید پشت JwtGuard+مالکیت است و سرور تلگرام نمی‌تواند آن را fetch کند
  sendPhotoBuffer(
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
}
