import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Get,
  Logger,
  Post,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SellerBotService } from './seller-bot.service';
import type { TelegramUpdate } from '../telegram/telegram.types';

// docs/PRD-seller-telegram-management-bot.md — وبهوک بات دوم (مدیریت پنل)، کاملاً جدا از
// v2/telegram/webhook؛ همان الگوی امنیتی (secret_token هدر، نه auth کاربر)
@Controller('v2/seller-bot')
export class SellerBotController {
  private readonly logger = new Logger(SellerBotController.name);

  constructor(private readonly sellerBot: SellerBotService) {}

  // R2.3 — نام بات از کانفیگ بک‌اند (نه env بیلد فرانت)؛ عمومی و بی‌خطر چون username خود بات
  // عمومی است. بدون env مقدار null می‌دهد و فرانت دکمه‌ی اتصال را نشان نمی‌دهد.
  @SkipThrottle()
  @Get('info')
  info(): { username: string | null } {
    return { username: this.sellerBot.getBotUsername() };
  }

  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secret?: string,
  ): Promise<{ ok: true }> {
    if (!this.sellerBot.verifySecret(secret)) {
      this.logger.warn('webhook rejected: secret_token mismatch');
      throw new ForbiddenException();
    }
    await this.sellerBot.handleUpdate(update);
    return { ok: true };
  }
}
