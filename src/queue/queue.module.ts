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
import { StudioVideoGenerationProcessor } from './processors/studio-video-generation.processor';
import { PrismaModule } from '../prisma/prisma.module';
import { MessageFeedbackModule } from '../modules/message-feedback/message-feedback.module';
import { CampaignModule } from '../modules/campaign/campaign.module';
import { LiveStatsModule } from '../modules/live-stats/live-stats.module';
import { AdminNotificationsModule } from '../modules/admin-notifications/admin-notifications.module';
import { LiaraModule } from '../modules/liara/liara.module';
import { UsageModule } from '../modules/usage/usage.module';
import { PushNotificationsModule } from '../modules/push-notifications/push-notifications.module';
import { VideoGenerationModule } from '../common/services/video-generation.module';

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
    // docs/PRD-video-studio-chat-flow.md §۸.۶ — همون صف که video-studio.module.ts هم رجیستر
    // می‌کند (تولیدکننده‌ی job)؛ پردازشگرش همین‌جاست، دقیقاً الگوی بقیه‌ی صف‌های این ماژول
    BullModule.registerQueue({ name: 'studio-video-generation' }),
    PrismaModule,
    MessageFeedbackModule,
    CampaignModule,
    LiveStatsModule,
    AdminNotificationsModule,
    LiaraModule,
    UsageModule,
    PushNotificationsModule,
    VideoGenerationModule,
  ],
  providers: [
    QueueService,
    TokenFlushProcessor,
    FeedbackSummaryProcessor,
    ModelFeedbackSummaryProcessor,
    WaitlistReminderProcessor,
    ChatImageCleanupProcessor,
    AdminAlertsProcessor,
    LiaraUsageSyncProcessor,
    LiaraKeyRetryProcessor,
    StudioVideoGenerationProcessor,
  ],
})
export class QueueModule {}
