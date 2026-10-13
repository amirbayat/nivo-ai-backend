import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { SkipThrottle } from '@nestjs/throttler';
import type { Queue } from 'bull';
import { WEBHOOK_DEDUPE_TTL_SECONDS } from '../../common/constants/sales-ops.constants';
import { RedisService } from '../../redis/redis.service';
import { TELEGRAM_UPDATES_QUEUE } from './telegram-updates.processor';
import { TelegramService } from './telegram.service';
import type { TelegramUpdate } from './telegram.types';

// docs/PRD-telegram-bot-channel.md بخش ۴.۱ — بدون JwtGuard (تلگرام از بیرون صدا می‌زند)؛
// امنیت با secret_token هدر تأمین می‌شود، نه auth کاربر. باید فوراً ۲۰۰ برگرداند (تلگرام
// دیرجوابی را retry می‌کند) — 0.5: آپدیت بعد از dedupe روی update_id در صف Bull
// (telegram-updates) می‌رود و پردازش خارج از چرخه‌ی HTTP انجام می‌شود.
@Controller('v2/telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly telegram: TelegramService,
    private readonly redis: RedisService,
    @InjectQueue(TELEGRAM_UPDATES_QUEUE)
    private readonly updatesQueue: Queue<TelegramUpdate>,
  ) {}

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
          ? `message:${update.message.text ? 'text' : update.message.photo ? 'photo' : update.message.voice ? 'voice' : update.message.document ? 'document' : '?'}`
          : update.callback_query
            ? 'callback_query'
            : 'unknown'
      }`,
    );
    if (!this.telegram.verifySecret(secret)) {
      this.logger.warn('webhook rejected: secret_token mismatch');
      throw new ForbiddenException();
    }
    // 0.5 — dedupe: تلگرام روی پاسخ کند دوباره می‌فرستد (دو جواب، دو هزینه، دو تغییر سبد)
    if (update.update_id !== undefined) {
      const first = await this.redis.set(
        `tg:upd:${update.update_id}`,
        '1',
        'EX',
        WEBHOOK_DEDUPE_TTL_SECONDS,
        'NX',
      );
      if (first !== 'OK') {
        this.logger.log(`duplicate update_id=${update.update_id} ignored`);
        return { ok: true };
      }
    }
    await this.updatesQueue.add('handle-update', update, {
      jobId:
        update.update_id !== undefined ? `tg-${update.update_id}` : undefined,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return { ok: true };
  }
}
