import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bull';
import { RedisService } from '../../redis/redis.service';
import { LiveStatsService } from '../../modules/live-stats/live-stats.service';
import { AdminNotificationsService } from '../../modules/admin-notifications/admin-notifications.service';
import { fa } from '../../i18n/fa';

// docs/PRD-admin-notifications-and-mobile.md بخش ۴/۹ — آستانه‌های پیش‌فرض، قابل تنظیم بعد از
// دیدن نرخ واقعی؛ تا آن زمان همین مقادیر پیاده‌سازی می‌شوند
const WINDOW_MINUTES = 5;
const SYSTEM_ERROR_THRESHOLD = 20;
const LIARA_MIN_SAMPLE_SIZE = 10;
const LIARA_FAIL_RATE_THRESHOLD = 0.3;
// یک اسپایک طولانی نباید هر ۵ دقیقه یک نوتیف جدید بسازد — بخش ۸ ریسک‌ها
const ALERT_COOLDOWN_SECONDS = 15 * 60;

// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۶ — الگوی «شکست خاموش»
const QUEUE_FAILURE_THRESHOLD = 3;
const QUEUE_FAILURE_SAMPLE_SIZE = 20;
// صف خودِ admin-alerts عمداً اینجا نیست — چک‌کردن شکست خودش داخل خودش معنی ندارد
const MONITORED_QUEUE_NAMES = [
  'token-flush',
  'feedback-summary',
  'model-feedback-summary',
  'waitlist-reminder',
  'chat-image-cleanup',
  'liara-usage-sync',
  'liara-key-retry',
  'caption-transcribe',
  'caption-render',
  'caption-source-cleanup',
  'video-edit',
  'image-model-cost-estimate',
  'video-model-cost-estimate',
  'sales-agent-voice',
] as const;

@Processor('admin-alerts')
export class AdminAlertsProcessor {
  private readonly logger = new Logger(AdminAlertsProcessor.name);

  constructor(
    private readonly redis: RedisService,
    private readonly liveStats: LiveStatsService,
    private readonly adminNotifications: AdminNotificationsService,
    @InjectQueue('token-flush') private readonly tokenFlushQueue: Queue,
    @InjectQueue('feedback-summary')
    private readonly feedbackSummaryQueue: Queue,
    @InjectQueue('model-feedback-summary')
    private readonly modelFeedbackSummaryQueue: Queue,
    @InjectQueue('waitlist-reminder')
    private readonly waitlistReminderQueue: Queue,
    @InjectQueue('chat-image-cleanup')
    private readonly chatImageCleanupQueue: Queue,
    @InjectQueue('liara-usage-sync')
    private readonly liaraUsageSyncQueue: Queue,
    @InjectQueue('liara-key-retry') private readonly liaraKeyRetryQueue: Queue,
    @InjectQueue('caption-transcribe')
    private readonly captionTranscribeQueue: Queue,
    @InjectQueue('caption-render') private readonly captionRenderQueue: Queue,
    @InjectQueue('caption-source-cleanup')
    private readonly captionSourceCleanupQueue: Queue,
    @InjectQueue('video-edit') private readonly videoEditQueue: Queue,
    @InjectQueue('image-model-cost-estimate')
    private readonly imageModelCostEstimateQueue: Queue,
    @InjectQueue('video-model-cost-estimate')
    private readonly videoModelCostEstimateQueue: Queue,
    @InjectQueue('sales-agent-voice')
    private readonly salesAgentVoiceQueue: Queue,
  ) {}

  @Process('check')
  async handleCheck() {
    await Promise.all([
      this.checkSystemErrors(),
      this.checkLiaraErrorRate(),
      this.checkQueueFailures(),
    ]);
  }

  private async checkSystemErrors() {
    const count = await this.liveStats.getServerErrorCount(WINDOW_MINUTES);
    if (count <= SYSTEM_ERROR_THRESHOLD) return;

    const acquired = await this.acquireCooldown('system-error');
    if (!acquired) return;

    await this.adminNotifications
      .notify(
        'SYSTEM_ERROR_SPIKE',
        fa.adminNotification.systemErrorTitle,
        fa.adminNotification.systemErrorBody(count, WINDOW_MINUTES),
        {
          windowMinutes: WINDOW_MINUTES,
          errorCount: count,
          threshold: SYSTEM_ERROR_THRESHOLD,
        },
      )
      .catch((err) =>
        this.logger.error('SYSTEM_ERROR_SPIKE notify failed', err),
      );
  }

  private async checkLiaraErrorRate() {
    const { total, fail } =
      await this.liveStats.getLiaraFailureStats(WINDOW_MINUTES);
    if (total < LIARA_MIN_SAMPLE_SIZE) return;

    const failRate = fail / total;
    if (failRate <= LIARA_FAIL_RATE_THRESHOLD) return;

    const acquired = await this.acquireCooldown('liara-error');
    if (!acquired) return;

    await this.adminNotifications
      .notify(
        'LIARA_ERROR_RATE',
        fa.adminNotification.liaraErrorTitle,
        fa.adminNotification.liaraErrorBody(failRate, total, WINDOW_MINUTES),
        {
          windowMinutes: WINDOW_MINUTES,
          failRate,
          sampleSize: total,
          threshold: LIARA_FAIL_RATE_THRESHOLD,
        },
      )
      .catch((err) => this.logger.error('LIARA_ERROR_RATE notify failed', err));
  }

  private async checkQueueFailures() {
    const queues: Record<(typeof MONITORED_QUEUE_NAMES)[number], Queue> = {
      'token-flush': this.tokenFlushQueue,
      'feedback-summary': this.feedbackSummaryQueue,
      'model-feedback-summary': this.modelFeedbackSummaryQueue,
      'waitlist-reminder': this.waitlistReminderQueue,
      'chat-image-cleanup': this.chatImageCleanupQueue,
      'liara-usage-sync': this.liaraUsageSyncQueue,
      'liara-key-retry': this.liaraKeyRetryQueue,
      'caption-transcribe': this.captionTranscribeQueue,
      'caption-render': this.captionRenderQueue,
      'caption-source-cleanup': this.captionSourceCleanupQueue,
      'video-edit': this.videoEditQueue,
      'image-model-cost-estimate': this.imageModelCostEstimateQueue,
      'video-model-cost-estimate': this.videoModelCostEstimateQueue,
      'sales-agent-voice': this.salesAgentVoiceQueue,
    };

    await Promise.all(
      MONITORED_QUEUE_NAMES.map((name) =>
        this.checkQueueFailureCount(name, queues[name]),
      ),
    );
  }

  private async checkQueueFailureCount(name: string, queue: Queue) {
    // getFailedCount شمارش تجمعیه (تا وقتی پاک نشه) — برای شمارش «اخیر» باید
    // خودِ jobها را با finishedOn فیلتر کرد، نه شمارش کلی صف
    const recentFailed = await queue.getFailed(
      0,
      QUEUE_FAILURE_SAMPLE_SIZE - 1,
    );
    const windowStart = Date.now() - WINDOW_MINUTES * 60 * 1000;
    const count = recentFailed.filter(
      (job) => (job.finishedOn ?? 0) >= windowStart,
    ).length;
    if (count < QUEUE_FAILURE_THRESHOLD) return;

    const acquired = await this.acquireCooldown(`queue-failure:${name}`);
    if (!acquired) return;

    await this.adminNotifications
      .notify(
        'QUEUE_JOB_FAILED',
        fa.adminNotification.queueJobFailedTitle,
        fa.adminNotification.queueJobFailedBody(name, count, WINDOW_MINUTES),
        {
          queueName: name,
          failedCount: count,
          windowMinutes: WINDOW_MINUTES,
          threshold: QUEUE_FAILURE_THRESHOLD,
        },
      )
      .catch((err) =>
        this.logger.error(`QUEUE_JOB_FAILED notify failed (${name})`, err),
      );
  }

  /** true فقط اگر این اولین بار در ۱۵ دقیقه‌ی اخیر باشد که این نوع آستانه رد شده — با SET NX */
  private async acquireCooldown(key: string): Promise<boolean> {
    const result = await this.redis.set(
      `admin-alert:cooldown:${key}`,
      '1',
      'EX',
      ALERT_COOLDOWN_SECONDS,
      'NX',
    );
    return result === 'OK';
  }
}
