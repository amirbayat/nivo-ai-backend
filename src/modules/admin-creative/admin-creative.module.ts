import { Module } from '@nestjs/common'
import { AdminCreativeController } from './admin-creative.controller'
import { AdminCreativeService } from './admin-creative.service'
import { ChatConfigModule } from '../chat-config/chat-config.module'

@Module({
  imports: [ChatConfigModule],
  controllers: [AdminCreativeController],
  providers: [AdminCreativeService],
})
export class AdminCreativeModule {}
