import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { NotificationService } from '../notifications/notification.service';
import {
  CREDIT_ALERT_DEDUPE_TTL_SECONDS,
  CREDIT_LOW_WARNING_RATIO,
} from '../../common/constants/sales-ops.constants';
import { fa } from '../../i18n/fa';

// فاز ۱ (1.5) — هشدار اعتبار: «رو به اتمام» وقتی موجودی ≤ ۲۰٪ آخرین شارژ، «تموم شد» وقتی
// مکالمه‌ای به‌خاطر اعتبار handoff می‌شود؛ هر کدام حداکثر روزی یک‌بار به‌ازای فروشگاه (قبلاً به‌ازای
// هر مکالمه‌ی بلاک یک پیام می‌رفت). کانال: بات فروشنده + SMS.
// ارسال واقعی (بات فروشنده + SMS + NotificationLog) از NotificationService است (3.6، D-6)؛
// این سرویس فقط «کی» را تصمیم می‌گیرد (آستانه‌ها و dedupe روزانه).
@Injectable()
export class CreditAlertService {
  private readonly logger = new Logger(CreditAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationService,
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
        'CREDIT_EXHAUSTED',
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
        'CREDIT_LOW',
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

  private async send(
    kind: 'CREDIT_EXHAUSTED' | 'CREDIT_LOW',
    storeId: string,
    botText: string,
    smsText: string,
  ) {
    await this.notifications.notifySeller({
      storeId,
      template: kind,
      entityId: storeId,
      botText,
      smsText,
    });
  }
}
