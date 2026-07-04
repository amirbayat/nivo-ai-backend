import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { UsageModule } from '../usage/usage.module'
import { RedisModule } from '../../redis/redis.module'
import { ModelRouterModule } from '../model-router/model-router.module'

@Module({
  imports: [UsageModule, RedisModule, ModelRouterModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
