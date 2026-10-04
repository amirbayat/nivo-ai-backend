import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryModule } from '@sentry/nestjs/setup';
import { ConfigModule } from '@nestjs/config';
import { validate } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AiProviderModule } from './common/services/ai-provider.module';
import { HealthModule } from './health/health.module';
import { StorageModule } from './storage/storage.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsageModule } from './modules/usage/usage.module';
import { PlansModule } from './modules/plans/plans.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { ChatModule } from './modules/chat/chat.module';
import { ChatConfigModule } from './modules/chat-config/chat-config.module';
import { GrowthModule } from './modules/growth/growth.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { AdminModule } from './modules/admin/admin.module';
import { UsersModule } from './modules/users/users.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { SalesModule } from './modules/sales/sales.module';
import { ModelRouterModule } from './modules/model-router/model-router.module';
import { MessageFeedbackModule } from './modules/message-feedback/message-feedback.module';
import { UsageAnalyticsModule } from './modules/usage-analytics/usage-analytics.module';
import { CampaignModule } from './modules/campaign/campaign.module';
import { AppConfigModule } from './modules/app-config/app-config.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { LiveStatsModule } from './modules/live-stats/live-stats.module';
import { NetworkOutageModule } from './modules/network-outage/network-outage.module';
import { AdminNotificationsModule } from './modules/admin-notifications/admin-notifications.module';
import { DeviceTokensModule } from './modules/device-tokens/device-tokens.module';
import { PushNotificationsModule } from './modules/push-notifications/push-notifications.module';
import { QueueModule } from './queue/queue.module';
import { AnonChatModule } from './modules/anon-chat/anon-chat.module';
import { CreditsModule } from './modules/credits/credits.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { AdminCreativeModule } from './modules/admin-creative/admin-creative.module';
import { AdminStoreCreditModule } from './modules/admin-store-credit/admin-store-credit.module';
import { NivoCalModule } from './modules/nivo-cal/nivo-cal.module';
import { CaptionStudioModule } from './modules/caption-studio/caption-studio.module';
import { VideoEditModule } from './modules/video-edit/video-edit.module';
import { VideoEditConfigModule } from './modules/video-edit-config/video-edit-config.module';
import { KieVideoModelsModule } from './modules/kie-video-models/kie-video-models.module';
import { ContentAgentModule } from './modules/content-agent/content-agent.module';
import { StoreModule } from './modules/store/store.module';
import { SalesAgentModule } from './modules/sales-agent/sales-agent.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { CommentsModule } from './modules/comments/comments.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, validate }),
    PrismaModule,
    RedisModule,
    AiProviderModule,
    HealthModule,
    StorageModule,
    RateLimitModule,
    QueueModule,
    AuthModule,
    UsageModule,
    PlansModule,
    ConversationsModule,
    ChatModule,
    ChatConfigModule,
    GrowthModule,
    PaymentsModule,
    InvoicesModule,
    SubscriptionsModule,
    AdminModule,
    UsersModule,
    FeedbackModule,
    TicketsModule,
    SalesModule,
    ModelRouterModule,
    MessageFeedbackModule,
    UsageAnalyticsModule,
    CampaignModule,
    AppConfigModule,
    ArticlesModule,
    LiveStatsModule,
    NetworkOutageModule,
    AdminNotificationsModule,
    DeviceTokensModule,
    PushNotificationsModule,
    AnonChatModule,
    CreditsModule,
    ProjectsModule,
    DiscoveryModule,
    AdminCreativeModule,
    AdminStoreCreditModule,
    NivoCalModule,
    CaptionStudioModule,
    VideoEditModule,
    VideoEditConfigModule,
    KieVideoModelsModule,
    ContentAgentModule,
    StoreModule,
    SalesAgentModule,
    CommentsModule,
    TelegramModule,
    MarketplaceModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
