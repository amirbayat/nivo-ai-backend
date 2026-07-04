import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { QueueService } from './queue.service'
import { TokenFlushProcessor } from './processors/token-flush.processor'
import { FeedbackSummaryProcessor } from './processors/feedback-summary.processor'
import { ModelFeedbackSummaryProcessor } from './processors/model-feedback-summary.processor'
import { PrismaModule } from '../prisma/prisma.module'
import { MessageFeedbackModule } from '../modules/message-feedback/message-feedback.module'

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
    PrismaModule,
    MessageFeedbackModule,
  ],
  providers: [
    QueueService,
    TokenFlushProcessor,
    FeedbackSummaryProcessor,
    ModelFeedbackSummaryProcessor,
  ],
})
export class QueueModule {}
