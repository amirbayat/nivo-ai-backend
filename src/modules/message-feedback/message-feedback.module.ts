import { Module } from '@nestjs/common'
import { MessageFeedbackController } from './message-feedback.controller'
import { MessageFeedbackService } from './message-feedback.service'
import { PrismaModule } from '../../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [MessageFeedbackController],
  providers: [MessageFeedbackService],
  exports: [MessageFeedbackService],
})
export class MessageFeedbackModule {}
