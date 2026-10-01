import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { TokenFlushProcessor } from './processors/token-flush.processor';
import { FeedbackSummaryProcessor } from './processors/feedback-summary.processor';
import { ModelFeedbackSummaryProcessor } from './processors/model-feedback-summary.processor';
import { WaitlistReminderProcessor } from './processors/waitlist-reminder.processor';
import { ChatImageCleanupProcessor } from './processors/chat-image-cleanup.processor';
import { AdminAlertsProcessor } from './processors/admin-alerts.processor';
import { LiaraUsageSyncProcessor } from './processors/liara-usage-sync.processor';
import { LiaraKeyRetryProcessor } from './processors/liara-key-retry.processor';
import { CaptionTranscribeProcessor } from './processors/caption-transcribe.processor';
import { CaptionRenderProcessor } from './processors/caption-render.processor';
import { CaptionSourceCleanupProcessor } from './processors/caption-source-cleanup.processor';
import { VideoEditProcessor } from './processors/video-edit.processor';
import { ImageModelCostEstimateProcessor } from './processors/image-model-cost-estimate.processor';
import { VideoModelCostEstimateProcessor } from './processors/video-model-cost-estimate.processor';
import { SalesAgentVoiceProcessor } from './processors/sales-agent-voice.processor';
import { SalesAgentVoiceWebhookController } from '../modules/sales-agent/sales-agent-voice-webhook.controller';
import { SalesAgentVoiceWebhookService } from '../modules/sales-agent/sales-agent-voice-webhook.service';
import { ProductCommentModerationProcessor } from './processors/product-comment-moderation.processor';
import { PostPurchaseFollowUpProcessor } from './processors/post-purchase-followup.processor';
import { AbandonedCartReminderProcessor } from './processors/abandoned-cart-reminder.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { MessageFeedbackModule } from '../modules/message-feedback/message-feedback.module';
import { CampaignModule } from '../modules/campaign/campaign.module';
import { LiveStatsModule } from '../modules/live-stats/live-stats.module';
import { AdminNotificationsModule } from '../modules/admin-notifications/admin-notifications.module';
import { LiaraModule } from '../modules/liara/liara.module';
import { UsageModule } from '../modules/usage/usage.module';
import { CreditsModule } from '../modules/credits/credits.module';
import { PushNotificationsModule } from '../modules/push-notifications/push-notifications.module';
import { MediaTranscodeModule } from '../common/services/media-transcode.module';
import { AsrModule } from '../common/services/asr.module';
import { KieProviderModule } from '../common/services/kie-provider.module';
import { OpenRouterVideoProviderModule } from '../common/services/openrouter-video-provider.module';
import { VeoProviderModule } from '../common/services/veo-provider.module';
import { RunwayProviderModule } from '../common/services/runway-provider.module';
import { TelegramModule } from '../modules/telegram/telegram.module';
import { SalesAgentModule } from '../modules/sales-agent/sales-agent.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.get<string>('REDIS_URL'),
      }),
    }),
    BullModule.registerQueue({ name: 'token-flush' }),
    BullModule.registerQueue({ name: 'feedback-summary' }),
    BullModule.registerQueue({ name: 'model-feedback-summary' }),
    BullModule.registerQueue({ name: 'waitlist-reminder' }),
    BullModule.registerQueue({ name: 'chat-image-cleanup' }),
    BullModule.registerQueue({ name: 'admin-alerts' }),
    BullModule.registerQueue({ name: 'liara-usage-sync' }),
    BullModule.registerQueue({ name: 'liara-key-retry' }),
    // docs/PRD-video-auto-captions.md §۱۱/§۱۶.۴ — تولیدکننده در caption-studio.module.ts
    BullModule.registerQueue({
      name: 'caption-transcribe',
      settings: { lockDuration: 10 * 60 * 1000 },
    }),
    BullModule.registerQueue({
      name: 'caption-render',
      settings: { lockDuration: 10 * 60 * 1000 },
    }),
    // safety-net حذف خودکار سورس بعد از ۷ روز بی‌فعالیتی — caption-source-cleanup.processor.ts
    BullModule.registerQueue({ name: 'caption-source-cleanup' }),
    // docs/PRD-video-edit-omni-kie.md §۵.۲ — تولیدکننده در video-edit.module.ts؛ همون
    // lockDuration بزرگ ویدیوی موجود (job تا ۳۰ دقیقه poll + grace بعد از تایم‌اوت اول —
    // ۸ دقیقه برای بقیه‌ی providerها، ~۸۰ دقیقه برای Veo که کندتر است — رجوع کن به
    // EXTRA_GRACE_POLL_ATTEMPTS/EXTRA_GRACE_POLL_ATTEMPTS_VEO در video-edit.processor.ts)
    BullModule.registerQueue({
      name: 'video-edit',
      settings: { lockDuration: 120 * 60 * 1000 },
    }),
    // docs/PRD-image-gen-usd-estimate.md — daily job stores provider USD per image model
    BullModule.registerQueue({ name: 'image-model-cost-estimate' }),
    BullModule.registerQueue({ name: 'video-model-cost-estimate' }),
    // docs/PRD-sales-agent-voice.md — تولیدکننده در sales-agent.module.ts
    BullModule.registerQueue({ name: 'sales-agent-voice' }),
    // docs/PRD-customer-comments-and-discounts.md — تولیدکننده در comments.module.ts
    BullModule.registerQueue({ name: 'product-comment-moderation' }),
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۳/۵.۴
    BullModule.registerQueue({ name: 'post-purchase-followup' }),
    BullModule.registerQueue({ name: 'abandoned-cart-reminder' }),
    PrismaModule,
    MessageFeedbackModule,
    CampaignModule,
    LiveStatsModule,
    AdminNotificationsModule,
    LiaraModule,
    UsageModule,
    PushNotificationsModule,
    MediaTranscodeModule,
    AsrModule,
    KieProviderModule,
    OpenRouterVideoProviderModule,
    VeoProviderModule,
    RunwayProviderModule,
    CreditsModule,
    TelegramModule,
    // docs/PRD-seller-credit-billing.md — CreditService برای لاگ مصرف VOICE_TTS در
    // SalesAgentVoiceProcessor پایین
    SalesAgentModule,
  ],
  // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — SalesAgentVoiceWebhookController اینجاست (نه در sales-agent
  // module) چون SalesAgentVoiceWebhookService مستقیم SalesAgentVoiceProcessor را تزریق
  // می‌کند (recoverFromWebhook) و آن provider همین‌جاست؛ وارد کردن QueueModule داخل
  // SalesAgentModule یک import چرخه‌ای می‌ساخت (QueueModule از قبل SalesAgentModule را
  // import می‌کند)
  controllers: [SalesAgentVoiceWebhookController],
  providers: [
    SalesAgentVoiceWebhookService,
    QueueService,
    TokenFlushProcessor,
    FeedbackSummaryProcessor,
    ModelFeedbackSummaryProcessor,
    WaitlistReminderProcessor,
    ChatImageCleanupProcessor,
    AdminAlertsProcessor,
    LiaraUsageSyncProcessor,
    LiaraKeyRetryProcessor,
    CaptionTranscribeProcessor,
    CaptionRenderProcessor,
    CaptionSourceCleanupProcessor,
    VideoEditProcessor,
    ImageModelCostEstimateProcessor,
    VideoModelCostEstimateProcessor,
    SalesAgentVoiceProcessor,
    ProductCommentModerationProcessor,
    PostPurchaseFollowUpProcessor,
    AbandonedCartReminderProcessor,
  ],
})
export class QueueModule {}
