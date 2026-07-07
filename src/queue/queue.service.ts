import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import type { Queue } from 'bull'

const FLUSH_CRON = '*/5 * * * *'
const SUMMARY_CRON = '0 2 * * *'
const MODEL_FEEDBACK_SUMMARY_CRON = '0 3 * * *' // یک ساعت بعد از فیدبک عمومی، تا فشار هم‌زمان روی AI provider نباشد
const WAITLIST_REMINDER_CRON = '0 9 * * *' // ساعت ۹ صبح — پیامک یادآوری در ساعت معقولی برسد

@Injectable()
export class QueueService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueService.name)

  constructor(
    @InjectQueue('token-flush') private readonly tokenFlushQueue: Queue,
    @InjectQueue('feedback-summary')
    private readonly feedbackSummaryQueue: Queue,
    @InjectQueue('model-feedback-summary')
    private readonly modelFeedbackSummaryQueue: Queue,
    @InjectQueue('waitlist-reminder')
    private readonly waitlistReminderQueue: Queue,
  ) {}

  async onApplicationBootstrap() {
    const tokenRepeatables = await this.tokenFlushQueue.getRepeatableJobs()
    for (const job of tokenRepeatables) {
      await this.tokenFlushQueue.removeRepeatableByKey(job.key)
    }
    await this.tokenFlushQueue.add(
      'flush',
      {},
      { repeat: { cron: FLUSH_CRON } },
    )
    this.logger.log(`Token flush job scheduled: ${FLUSH_CRON}`)

    const summaryRepeatables =
      await this.feedbackSummaryQueue.getRepeatableJobs()
    for (const job of summaryRepeatables) {
      await this.feedbackSummaryQueue.removeRepeatableByKey(job.key)
    }
    await this.feedbackSummaryQueue.add(
      'summarize',
      {},
      { repeat: { cron: SUMMARY_CRON } },
    )
    this.logger.log(`Feedback summary job scheduled: ${SUMMARY_CRON}`)

    const modelFeedbackRepeatables =
      await this.modelFeedbackSummaryQueue.getRepeatableJobs()
    for (const job of modelFeedbackRepeatables) {
      await this.modelFeedbackSummaryQueue.removeRepeatableByKey(job.key)
    }
    await this.modelFeedbackSummaryQueue.add(
      'summarize',
      {},
      { repeat: { cron: MODEL_FEEDBACK_SUMMARY_CRON } },
    )
    this.logger.log(
      `Model feedback summary job scheduled: ${MODEL_FEEDBACK_SUMMARY_CRON}`,
    )

    const waitlistRepeatables = await this.waitlistReminderQueue.getRepeatableJobs()
    for (const job of waitlistRepeatables) {
      await this.waitlistReminderQueue.removeRepeatableByKey(job.key)
    }
    await this.waitlistReminderQueue.add(
      'send-reminders',
      {},
      { repeat: { cron: WAITLIST_REMINDER_CRON } },
    )
    this.logger.log(`Waitlist reminder job scheduled: ${WAITLIST_REMINDER_CRON}`)
  }
}
