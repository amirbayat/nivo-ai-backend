import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { TELEGRAM_UPDATES_QUEUE_CONCURRENCY } from '../../common/constants/sales-ops.constants';
import { TelegramService } from './telegram.service';
import type { TelegramUpdate } from './telegram.types';

export const TELEGRAM_UPDATES_QUEUE = 'telegram-updates';

// PRD-nivo-sales-unified.md تسک 0.5 — پردازش آپدیت‌های تلگرام خارج از چرخه‌ی HTTP وب‌هوک
// (پاسخ ۲۰۰ فوری؛ قبلاً کل turn و تبدیل ویس تا ۹۰ثانیه await می‌شد و تلگرام دوباره می‌فرستاد).
// ترتیب پیام‌های یک چت را قفل مکالمه (0.4) حفظ می‌کند.
@Processor(TELEGRAM_UPDATES_QUEUE)
export class TelegramUpdatesProcessor {
  private readonly logger = new Logger(TelegramUpdatesProcessor.name);

  constructor(private readonly telegram: TelegramService) {}

  @Process({
    name: 'handle-update',
    concurrency: TELEGRAM_UPDATES_QUEUE_CONCURRENCY,
  })
  async handle(job: Job<TelegramUpdate>) {
    try {
      await this.telegram.handleUpdate(job.data);
    } catch (err) {
      // retry نمی‌کنیم: دوباره‌اجرای یک turn نیمه‌کاره = جواب و هزینه‌ی تکراری
      this.logger.error(
        `telegram update ${job.data.update_id} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
