import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SmsService } from '../../sms/sms.service';
import { SellerBotApiClientService } from '../seller-bot/seller-bot-api-client.service';
import {
  NOTIFICATION_DEDUPE_TTL_SECONDS,
  NOTIFICATION_JOB_ATTEMPTS,
} from '../../common/constants/sales-ops.constants';
import {
  NOTIFICATION_QUEUE,
  NotificationJob,
  NotifyBuyerInput,
  TEMPLATE_CHANNELS,
} from './notification.types';
import { smsQuietDelayMs } from './notification-schedule.util';

// docs/PRD-nivo-sales-unified.md 3.6 / D-6 — تنها نقطه‌ی ارسال اعلان (OTP استثناست).
// خریدار: صف Bull با retry (کانال‌ها جدا؛ SMS در ساعت سکوت تا ۰۸:۰۰ تهران صف می‌شود)،
// dedupe قالب+entity+کانال در ۱۰ دقیقه، سقف روزانه‌ی SMS هر خریدار در لحظه‌ی ارسال.
// فروشنده: ارسال مستقیم (بات + SMS) با لاگ — بات فروشنده/تلگرام خودش retry ندارد و اعلان‌های
// فروشنده کم‌حجم و فوری‌اند.
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly sellerBotApi: SellerBotApiClientService,
    private readonly sms: SmsService,
  ) {}

  // هیچ‌وقت throw نمی‌کند: شکست اعلان نباید انتقال وضعیت/تراکنش اصلی را خراب کند
  async notifyBuyer(input: NotifyBuyerInput): Promise<void> {
    for (const channel of TEMPLATE_CHANNELS[input.template]) {
      try {
        const key = `notif:${input.template}:${input.entityId}:${channel}`;
        const first = await this.redis.set(
          key,
          '1',
          'EX',
          NOTIFICATION_DEDUPE_TTL_SECONDS,
          'NX',
        );
        if (first !== 'OK') continue;
        const job: NotificationJob = {
          template: input.template,
          channel,
          customerId: input.to.customerId,
          entityId: input.entityId,
          data: input.data,
        };
        await this.queue.add('deliver', job, {
          attempts: NOTIFICATION_JOB_ATTEMPTS,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: 500,
          delay: channel === 'SMS' ? smsQuietDelayMs() : 0,
        });
      } catch (err) {
        this.logger.error(
          `enqueue failed (${input.template}/${channel}, entity=${input.entityId})`,
          err as Error,
        );
      }
    }
  }

  // اعلان فروشنده (بات تلگرام فروشنده + SMS به شماره‌ی حساب). dedupeKey اختیاری: اگر داده شود
  // با TTL داده‌شده فقط یک‌بار می‌رود.
  async notifySeller(input: {
    storeId: string;
    template: string;
    entityId?: string;
    botText: string;
    smsText?: string;
    dedupe?: { key: string; ttlSeconds: number };
  }): Promise<void> {
    try {
      if (input.dedupe) {
        const first = await this.redis.set(
          input.dedupe.key,
          '1',
          'EX',
          input.dedupe.ttlSeconds,
          'NX',
        );
        if (first !== 'OK') return;
      }
      const store = await this.prisma.store.findUnique({
        where: { id: input.storeId },
        select: { sellerBotChatId: true, seller: { select: { phone: true } } },
      });
      if (!store) return;
      if (store.sellerBotChatId) {
        await this.sellerBotApi
          .sendText(store.sellerBotChatId, input.botText)
          .then(() => this.log(input, 'BOT', store.sellerBotChatId!, 'SENT'))
          .catch((err) => {
            this.logger.error(
              `seller bot send failed (${input.template}, store=${input.storeId})`,
              err,
            );
            return this.log(input, 'BOT', store.sellerBotChatId!, 'FAILED', String(err));
          });
      }
      if (input.smsText && store.seller.phone) {
        await this.sms
          .sendFreeText(store.seller.phone, input.smsText)
          .then(() => this.log(input, 'SMS', store.seller.phone!, 'SENT'))
          .catch((err) => {
            this.logger.error(
              `seller sms failed (${input.template}, store=${input.storeId})`,
              err,
            );
            return this.log(input, 'SMS', store.seller.phone!, 'FAILED', String(err));
          });
      }
    } catch (err) {
      this.logger.error(
        `seller notify failed (${input.template}, store=${input.storeId})`,
        err as Error,
      );
    }
  }

  private async log(
    input: { template: string; entityId?: string },
    channel: string,
    to: string,
    status: string,
    error?: string,
  ): Promise<void> {
    await this.prisma.notificationLog
      .create({
        data: {
          template: input.template,
          channel,
          to,
          status,
          entityId: input.entityId,
          error: error?.slice(0, 500),
        },
      })
      .catch(() => undefined);
  }
}
