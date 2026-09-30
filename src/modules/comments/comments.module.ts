import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CommentsService } from './comments.service';
import { CommentsAdminController } from './comments-admin.controller';

// docs/PRD-customer-comments-and-discounts.md — مصرف‌کننده‌ی واقعی صف در
// queue.module.ts (product-comment-moderation.processor.ts)، همان الگوی sales-agent-voice
@Module({
  imports: [BullModule.registerQueue({ name: 'product-comment-moderation' })],
  controllers: [CommentsAdminController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
