import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TelegramKeyboard } from '../telegram/telegram.types';

// docs/PRD-seller-telegram-management-bot.md — کپی سبک TelegramApiClientService با env جدا
// (SELLER_BOT_*)؛ فایل جدا (نه تغییر سرویس موجود) تا هیچ ریسکی روی بات مشتری‌محور نباشد —
// توکن/وبهوک این بات کاملاً مستقل است
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

  private async callApi(
    method: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.botToken) {
      this.logger.warn(
        `seller bot ${method} skipped: SELLER_BOT_TOKEN not set`,
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
        `seller bot ${method} network error calling ${this.apiBaseUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
    if (!res.ok) {
      this.logger.error(
        `seller bot ${method} failed: ${res.status} ${await res.text()}`,
      );
    }
    return res.json().catch(() => null);
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
