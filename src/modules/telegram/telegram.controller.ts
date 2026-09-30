import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { TelegramService } from './telegram.service';
import type { TelegramUpdate } from './telegram.types';

// docs/PRD-telegram-bot-channel.md بخش ۴.۱ — بدون JwtGuard (تلگرام از بیرون صدا می‌زند)؛
// امنیت با secret_token هدر تأمین می‌شود، نه auth کاربر. باید فوراً ۲۰۰ برگرداند (تلگرام
// دیرجوابی را retry می‌کند) — پردازش synchronous ولی سریع نگه داشته شده (بدون صف جدا،
// همان‌طور که video-edit-webhook.controller.ts هم synchronous است).
@Controller('v2/telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private readonly telegram: TelegramService) {}

  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ): Promise<{ ok: true }> {
    // این لاگ عمداً قبل از چک secret است — اگر تلگرام اصلاً به اینجا نرسد، این خط هم توی
    // لاگ‌ها نمی‌آید؛ یعنی مشکل شبکه/DNS/وبهوک ثبت‌نشده است، نه چیزی داخل کد. اگر این خط
    // هست ولی خط بعدی (forbidden) هم هست، یعنی TELEGRAM_WEBHOOK_SECRET با secret_token
    // ثبت‌شده در setWebhook یکی نیست.
    this.logger.log(
      `webhook hit update_id=${update.update_id ?? '?'} chat=${
        update.message?.chat.id ??
        update.callback_query?.message?.chat.id ??
        '?'
      } type=${
        update.message
          ? `message:${update.message.text ? 'text' : update.message.photo ? 'photo' : update.message.voice ? 'voice' : '?'}`
          : update.callback_query
            ? 'callback_query'
            : 'unknown'
      }`,
    );
    if (!this.telegram.verifySecret(secret)) {
      this.logger.warn('webhook rejected: secret_token mismatch');
      throw new ForbiddenException();
    }
    await this.telegram.handleUpdate(update);
    return { ok: true };
  }
}
