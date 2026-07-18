import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { RedisService } from '../../redis/redis.service'
import { LiveStatsService } from '../../modules/live-stats/live-stats.service'
import { AdminNotificationsService } from '../../modules/admin-notifications/admin-notifications.service'
import { fa } from '../../i18n/fa'

// docs/PRD-admin-notifications-and-mobile.md بخش ۴/۹ — آستانه‌های پیش‌فرض، قابل تنظیم بعد از
// دیدن نرخ واقعی؛ تا آن زمان همین مقادیر پیاده‌سازی می‌شوند
const WINDOW_MINUTES = 5
const SYSTEM_ERROR_THRESHOLD = 20
const LIARA_MIN_SAMPLE_SIZE = 10
const LIARA_FAIL_RATE_THRESHOLD = 0.3
// یک اسپایک طولانی نباید هر ۵ دقیقه یک نوتیف جدید بسازد — بخش ۸ ریسک‌ها
const ALERT_COOLDOWN_SECONDS = 15 * 60

@Processor('admin-alerts')
export class AdminAlertsProcessor {
  private readonly logger = new Logger(AdminAlertsProcessor.name)

  constructor(
    private readonly redis: RedisService,
    private readonly liveStats: LiveStatsService,
    private readonly adminNotifications: AdminNotificationsService,
  ) {}

  @Process('check')
  async handleCheck() {
    await Promise.all([this.checkSystemErrors(), this.checkLiaraErrorRate()])
  }

  private async checkSystemErrors() {
    const count = await this.liveStats.getServerErrorCount(WINDOW_MINUTES)
    if (count <= SYSTEM_ERROR_THRESHOLD) return

    const acquired = await this.acquireCooldown('system-error')
    if (!acquired) return

    await this.adminNotifications
      .notify(
        'SYSTEM_ERROR_SPIKE',
        fa.adminNotification.systemErrorTitle,
        fa.adminNotification.systemErrorBody(count, WINDOW_MINUTES),
        { windowMinutes: WINDOW_MINUTES, errorCount: count, threshold: SYSTEM_ERROR_THRESHOLD },
      )
      .catch((err) => this.logger.error('SYSTEM_ERROR_SPIKE notify failed', err))
  }

  private async checkLiaraErrorRate() {
    const { total, fail } = await this.liveStats.getLiaraFailureStats(WINDOW_MINUTES)
    if (total < LIARA_MIN_SAMPLE_SIZE) return

    const failRate = fail / total
    if (failRate <= LIARA_FAIL_RATE_THRESHOLD) return

    const acquired = await this.acquireCooldown('liara-error')
    if (!acquired) return

    await this.adminNotifications
      .notify(
        'LIARA_ERROR_RATE',
        fa.adminNotification.liaraErrorTitle,
        fa.adminNotification.liaraErrorBody(failRate, total, WINDOW_MINUTES),
        { windowMinutes: WINDOW_MINUTES, failRate, sampleSize: total, threshold: LIARA_FAIL_RATE_THRESHOLD },
      )
      .catch((err) => this.logger.error('LIARA_ERROR_RATE notify failed', err))
  }

  /** true فقط اگر این اولین بار در ۱۵ دقیقه‌ی اخیر باشد که این نوع آستانه رد شده — با SET NX */
  private async acquireCooldown(key: string): Promise<boolean> {
    const result = await this.redis.set(`admin-alert:cooldown:${key}`, '1', 'EX', ALERT_COOLDOWN_SECONDS, 'NX')
    return result === 'OK'
  }
}
