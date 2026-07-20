import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { UsageModule } from '../usage/usage.module'
import { RedisModule } from '../../redis/redis.module'
import { ModelRouterModule } from '../model-router/model-router.module'
import { UsageAnalyticsModule } from '../usage-analytics/usage-analytics.module'
import { CampaignModule } from '../campaign/campaign.module'
import { ChatConfigModule } from '../chat-config/chat-config.module'
import { LiveStatsModule } from '../live-stats/live-stats.module'
import { LiaraModule } from '../liara/liara.module'

@Module({
  imports: [
    UsageModule, RedisModule, ModelRouterModule, UsageAnalyticsModule,
    CampaignModule, ChatConfigModule, LiveStatsModule, LiaraModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
