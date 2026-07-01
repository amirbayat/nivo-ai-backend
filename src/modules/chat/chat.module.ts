import { Module } from '@nestjs/common'
import { ChatService } from './chat.service'
import { ChatController } from './chat.controller'
import { UsageModule } from '../usage/usage.module'
import { RedisModule } from '../../redis/redis.module'

@Module({
  imports: [UsageModule, RedisModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
