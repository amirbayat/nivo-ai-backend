import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
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
  constructor(private readonly telegram: TelegramService) {}

  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ): Promise<{ ok: true }> {
    if (!this.telegram.verifySecret(secret)) {
      throw new ForbiddenException();
    }
    await this.telegram.handleUpdate(update);
    return { ok: true };
  }
}
