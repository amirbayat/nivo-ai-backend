import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { AiProviderService } from '../common/services/ai-provider.service';

const FLUSH_CRON = '*/5 * * * *';
const SUMMARY_CRON = '0 2 * * *';
const MODEL_FEEDBACK_SUMMARY_CRON = '0 3 * * *'; // یک ساعت بعد از فیدبک عمومی، تا فشار هم‌زمان روی AI provider نباشد
const WAITLIST_REMINDER_CRON = '0 9 * * *'; // ساعت ۹ صبح — پیامک یادآوری در ساعت معقولی برسد
const CHAT_IMAGE_CLEANUP_CRON = '15 * * * *'; // ساعتی یک‌بار — عکس‌های چت قدیمی‌تر از ۲۴ ساعت حذف می‌شوند
// شبانه، ساعت ۳:۳۰ — safety-net حذف سورس ویدیوهای caption-studio که ۷ روز بی‌فعالیت مانده‌اند
const CAPTION_SOURCE_CLEANUP_CRON = '30 3 * * *';
// docs/PRD-admin-notifications-and-mobile.md بخش ۴/۷ — چک آستانه‌ی خطای سیستمی/Liara هر ۵ دقیقه
const ADMIN_ALERTS_CRON = '*/5 * * * *';
// موقتاً هر ۵ دقیقه برای رصد نزدیک‌به‌لحظه‌ی مصرف امروز — بعداً دوباره به یک‌بار در شبانه‌روز برمی‌گردد
const LIARA_USAGE_SYNC_CRON = '*/5 * * * *';
// docs/PRD-liara-usage-reconciliation.md — کاربرانی که ساخت کلید اختصاصی‌شان قبلاً fail شده را
// دوره‌ای دوباره امتحان می‌کند (مثلاً بعد از تمدید JWT مدیریتی در Hamravesh)
const LIARA_KEY_RETRY_CRON = '*/15 * * * *';
// docs/PRD-image-gen-usd-estimate.md — daily USD refresh; FX is applied at catalog read
const IMAGE_MODEL_COST_ESTIMATE_CRON = '0 4 * * *';

@Injectable()
export class QueueService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('token-flush') private readonly tokenFlushQueue: Queue,
    @InjectQueue('feedback-summary')
    private readonly feedbackSummaryQueue: Queue,
    @InjectQueue('model-feedback-summary')
    private readonly modelFeedbackSummaryQueue: Queue,
    @InjectQueue('waitlist-reminder')
    private readonly waitlistReminderQueue: Queue,
    @InjectQueue('chat-image-cleanup')
    private readonly chatImageCleanupQueue: Queue,
    @InjectQueue('caption-source-cleanup')
    private readonly captionSourceCleanupQueue: Queue,
    @InjectQueue('admin-alerts')
    private readonly adminAlertsQueue: Queue,
    @InjectQueue('liara-usage-sync')
    private readonly liaraUsageSyncQueue: Queue,
    @InjectQueue('liara-key-retry')
    private readonly liaraKeyRetryQueue: Queue,
    @InjectQueue('image-model-cost-estimate')
    private readonly imageModelCostEstimateQueue: Queue,
    private readonly aiProvider: AiProviderService,
  ) {}

  async onApplicationBootstrap() {
    const tokenRepeatables = await this.tokenFlushQueue.getRepeatableJobs();
    for (const job of tokenRepeatables) {
      await this.tokenFlushQueue.removeRepeatableByKey(job.key);
    }
    await this.tokenFlushQueue.add(
      'flush',
      {},
      { repeat: { cron: FLUSH_CRON } },
    );
    this.logger.log(`Token flush job scheduled: ${FLUSH_CRON}`);

    const summaryRepeatables =
      await this.feedbackSummaryQueue.getRepeatableJobs();
    for (const job of summaryRepeatables) {
      await this.feedbackSummaryQueue.removeRepeatableByKey(job.key);
    }
    await this.feedbackSummaryQueue.add(
      'summarize',
      {},
      { repeat: { cron: SUMMARY_CRON } },
    );
    this.logger.log(`Feedback summary job scheduled: ${SUMMARY_CRON}`);

    const modelFeedbackRepeatables =
      await this.modelFeedbackSummaryQueue.getRepeatableJobs();
    for (const job of modelFeedbackRepeatables) {
      await this.modelFeedbackSummaryQueue.removeRepeatableByKey(job.key);
    }
    await this.modelFeedbackSummaryQueue.add(
      'summarize',
      {},
      { repeat: { cron: MODEL_FEEDBACK_SUMMARY_CRON } },
    );
    this.logger.log(
      `Model feedback summary job scheduled: ${MODEL_FEEDBACK_SUMMARY_CRON}`,
    );

    const waitlistRepeatables =
      await this.waitlistReminderQueue.getRepeatableJobs();
    for (const job of waitlistRepeatables) {
      await this.waitlistReminderQueue.removeRepeatableByKey(job.key);
    }
    await this.waitlistReminderQueue.add(
      'send-reminders',
      {},
      { repeat: { cron: WAITLIST_REMINDER_CRON } },
    );
    this.logger.log(
      `Waitlist reminder job scheduled: ${WAITLIST_REMINDER_CRON}`,
    );

    const chatImageCleanupRepeatables =
      await this.chatImageCleanupQueue.getRepeatableJobs();
    for (const job of chatImageCleanupRepeatables) {
      await this.chatImageCleanupQueue.removeRepeatableByKey(job.key);
    }
    await this.chatImageCleanupQueue.add(
      'cleanup',
      {},
      { repeat: { cron: CHAT_IMAGE_CLEANUP_CRON } },
    );
    this.logger.log(
      `Chat image cleanup job scheduled: ${CHAT_IMAGE_CLEANUP_CRON}`,
    );

    const captionSourceCleanupRepeatables =
      await this.captionSourceCleanupQueue.getRepeatableJobs();
    for (const job of captionSourceCleanupRepeatables) {
      await this.captionSourceCleanupQueue.removeRepeatableByKey(job.key);
    }
    await this.captionSourceCleanupQueue.add(
      'cleanup',
      {},
      { repeat: { cron: CAPTION_SOURCE_CLEANUP_CRON } },
    );
    this.logger.log(
      `Caption source cleanup job scheduled: ${CAPTION_SOURCE_CLEANUP_CRON}`,
    );

    const adminAlertsRepeatables =
      await this.adminAlertsQueue.getRepeatableJobs();
    for (const job of adminAlertsRepeatables) {
      await this.adminAlertsQueue.removeRepeatableByKey(job.key);
    }
    await this.adminAlertsQueue.add(
      'check',
      {},
      { repeat: { cron: ADMIN_ALERTS_CRON } },
    );
    this.logger.log(`Admin alerts check job scheduled: ${ADMIN_ALERTS_CRON}`);

    // docs/EXECUTION-PLAN.md قدم ۱۷ — این دو جاب فقط برای پلتفرم لیارا معنا دارند (کلید
    // اختصاصی/رصد مصرف Liara). روی OpenRouter غیرفعال می‌شوند (نه حذف — طبق §۱۷ برای اگر روزی
    // fallback به لیارا لازم شد دوباره لازم می‌شوند) و هر repeatable قبلی هم پاک می‌شود تا با
    // سوییچ AI_PROVIDER بلافاصله متوقف شوند، نه فقط از دفعه‌ی بعد.
    const liaraUsageSyncRepeatables =
      await this.liaraUsageSyncQueue.getRepeatableJobs();
    for (const job of liaraUsageSyncRepeatables) {
      await this.liaraUsageSyncQueue.removeRepeatableByKey(job.key);
    }
    const liaraKeyRetryRepeatables =
      await this.liaraKeyRetryQueue.getRepeatableJobs();
    for (const job of liaraKeyRetryRepeatables) {
      await this.liaraKeyRetryQueue.removeRepeatableByKey(job.key);
    }

    if (this.aiProvider.isOpenRouter) {
      this.logger.log(
        'Liara usage sync / key retry jobs skipped (AI_PROVIDER=openrouter)',
      );
    } else {
      await this.liaraUsageSyncQueue.add(
        'sync',
        {},
        { repeat: { cron: LIARA_USAGE_SYNC_CRON } },
      );
      this.logger.log(
        `Liara usage sync job scheduled: ${LIARA_USAGE_SYNC_CRON}`,
      );

      await this.liaraKeyRetryQueue.add(
        'retry',
        {},
        { repeat: { cron: LIARA_KEY_RETRY_CRON } },
      );
      this.logger.log(`Liara key retry job scheduled: ${LIARA_KEY_RETRY_CRON}`);
    }

    const imageModelCostEstimateRepeatables =
      await this.imageModelCostEstimateQueue.getRepeatableJobs();
    for (const job of imageModelCostEstimateRepeatables) {
      await this.imageModelCostEstimateQueue.removeRepeatableByKey(job.key);
    }
    await this.imageModelCostEstimateQueue.add(
      'estimate',
      {},
      { repeat: { cron: IMAGE_MODEL_COST_ESTIMATE_CRON } },
    );
    this.logger.log(
      `Image model cost estimate job scheduled: ${IMAGE_MODEL_COST_ESTIMATE_CRON}`,
    );
    await this.imageModelCostEstimateQueue.add(
      'estimate',
      {},
      { removeOnComplete: true, removeOnFail: true },
    );
    this.logger.log('Image model cost estimate job enqueued (one-shot on boot)');
  }
}
