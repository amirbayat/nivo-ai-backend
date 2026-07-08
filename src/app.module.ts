import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { validate } from './config/env.validation'
import { PrismaModule } from './prisma/prisma.module'
import { RedisModule } from './redis/redis.module'
import { AuthModule } from './modules/auth/auth.module'
import { UsageModule } from './modules/usage/usage.module'
import { PlansModule } from './modules/plans/plans.module'
import { ConversationsModule } from './modules/conversations/conversations.module'
import { ChatModule } from './modules/chat/chat.module'
import { PaymentsModule } from './modules/payments/payments.module'
import { InvoicesModule } from './modules/invoices/invoices.module'
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module'
import { AdminModule } from './modules/admin/admin.module'
import { UsersModule } from './modules/users/users.module'
import { FeedbackModule } from './modules/feedback/feedback.module'
import { TicketsModule } from './modules/tickets/tickets.module'
import { SalesModule } from './modules/sales/sales.module'
import { ModelRouterModule } from './modules/model-router/model-router.module'
import { MessageFeedbackModule } from './modules/message-feedback/message-feedback.module'
import { UsageAnalyticsModule } from './modules/usage-analytics/usage-analytics.module'
import { CampaignModule } from './modules/campaign/campaign.module'
import { QueueModule } from './queue/queue.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    PrismaModule,
    RedisModule,
    QueueModule,
    AuthModule,
    UsageModule,
    PlansModule,
    ConversationsModule,
    ChatModule,
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
  ],
})
export class AppModule {}
