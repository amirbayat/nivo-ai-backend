import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { UsageModule } from '../usage/usage.module'
import { RedisModule } from '../../redis/redis.module'
import { ModelRouterModule } from '../model-router/model-router.module'
import { UsageAnalyticsModule } from '../usage-analytics/usage-analytics.module'
import { CampaignModule } from '../campaign/campaign.module'

@Module({
  imports: [UsageModule, RedisModule, ModelRouterModule, UsageAnalyticsModule, CampaignModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
