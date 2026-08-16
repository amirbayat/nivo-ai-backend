import { Module } from '@nestjs/common';
import { UsageAnalyticsService } from './usage-analytics.service';
import { TopicService } from './topic.service';
import {
  UsageAnalyticsController,
  TopicController,
} from './usage-analytics.controller';

@Module({
  controllers: [UsageAnalyticsController, TopicController],
  providers: [UsageAnalyticsService, TopicService],
  exports: [UsageAnalyticsService, TopicService],
})
export class UsageAnalyticsModule {}
