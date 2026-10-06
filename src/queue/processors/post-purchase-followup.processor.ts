import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PostPurchaseFollowUpService } from '../../modules/sales-agent/post-purchase-followup.service';

@Processor('post-purchase-followup')
export class PostPurchaseFollowUpProcessor {
  private readonly logger = new Logger(PostPurchaseFollowUpProcessor.name);

  constructor(private readonly followUp: PostPurchaseFollowUpService) {}

  @Process('send-followups')
  async handle() {
    await this.followUp.sendDueFollowUps();
    this.logger.log('Post-purchase follow-up pass completed');
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۴.۲ — پیگیری سوم (۷روزه)،
  // همان صف (post-purchase-followup) با یک job name جدا
  @Process('send-media-review-followups')
  async handleMediaReview() {
    await this.followUp.sendDueMediaReviewFollowUps();
    this.logger.log('Media-review follow-up pass completed');
  }
}
