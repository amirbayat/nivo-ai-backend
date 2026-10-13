import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SmsService } from '../../sms/sms.service';
import { SellerBotApiClientService } from '../seller-bot/seller-bot-api-client.service';
import {
  CREDIT_ALERT_DEDUPE_TTL_SECONDS,
  CREDIT_LOW_WARNING_RATIO,
} from '../../common/constants/sales-ops.constants';
import { fa } from '../../i18n/fa';

// فاز ۱ (1.5) — هشدار اعتبار: «رو به اتمام» وقتی موجودی ≤ ۲۰٪ آخرین شارژ، «تموم شد» وقتی
// مکالمه‌ای به‌خاطر اعتبار handoff می‌شود؛ هر کدام حداکثر روزی یک‌بار به‌ازای فروشگاه (قبلاً به‌ازای
// هر مکالمه‌ی بلاک یک پیام می‌رفت). کانال: بات فروشنده + SMS.
// TODO(3.6): با ساخت NotificationService (گام ۳) این سرویس به آن منتقل می‌شود (D-6).
@Injectable()
export class CreditAlertService {
  private readonly logger = new Logger(CreditAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sellerBotApi: SellerBotApiClientService,
    private readonly sms: SmsService,
  ) {}

  private async firstToday(kind: 'exhausted' | 'low', storeId: string) {
    const ok = await this.redis.set(
      `credit:alert:${kind}:${storeId}`,
      '1',
      'EX',
      CREDIT_ALERT_DEDUPE_TTL_SECONDS,
      'NX',
    );
    return ok === 'OK';
  }

  async notifyExhausted(storeId: string): Promise<void> {
    try {
      if (!(await this.firstToday('exhausted', storeId))) return;
      await this.send(
        storeId,
        fa.creditAlert.exhaustedBot,
        fa.creditAlert.exhaustedSms,
      );
    } catch (err) {
      this.logger.error(
        `exhausted alert failed (store=${storeId})`,
        err as Error,
      );
    }
  }

  // بعد از هر کسر صدا زده می‌شود؛ ارزان است (یک مقایسه‌ی عددی) تا شرط برقرار شود
  async checkLow(storeId: string, spendableToman: number): Promise<void> {
    try {
      if (spendableToman <= 0) return; // «تموم شد» مسیر خودش را دارد
      const lastTopup = await this.prisma.creditUsageEvent.findFirst({
        where: { storeId, kind: 'TOPUP' },
        orderBy: { createdAt: 'desc' },
        select: { costToman: true },
      });
      if (!lastTopup || lastTopup.costToman <= 0) return;
      if (spendableToman > lastTopup.costToman * CREDIT_LOW_WARNING_RATIO)
        return;
      if (!(await this.firstToday('low', storeId))) return;
      await this.send(
        storeId,
        fa.creditAlert.lowBot(spendableToman),
        fa.creditAlert.lowSms,
      );
    } catch (err) {
      this.logger.error(
        `low-credit alert failed (store=${storeId})`,
        err as Error,
      );
    }
  }

  private async send(storeId: string, botText: string, smsText: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { sellerBotChatId: true, seller: { select: { phone: true } } },
    });
    if (!store) return;
    if (store.sellerBotChatId) {
      await this.sellerBotApi
        .sendText(store.sellerBotChatId, botText)
        .catch((err) =>
          this.logger.error(
            `credit alert bot send failed (store=${storeId})`,
            err,
          ),
        );
    }
    if (store.seller.phone) {
      await this.sms
        .sendFreeText(store.seller.phone, smsText)
        .catch((err) =>
          this.logger.error(`credit alert sms failed (store=${storeId})`, err),
        );
    }
  }
}
