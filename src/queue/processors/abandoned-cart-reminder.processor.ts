import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { AbandonedCartReminderService } from '../../modules/sales-agent/abandoned-cart-reminder.service';
import { SellerConversationFollowUpService } from '../../modules/sales-agent/seller-conversation-followup.service';

@Processor('abandoned-cart-reminder')
export class AbandonedCartReminderProcessor {
  private readonly logger = new Logger(AbandonedCartReminderProcessor.name);

  constructor(
    private readonly reminder: AbandonedCartReminderService,
    private readonly sellerFollowUp: SellerConversationFollowUpService,
  ) {}

  @Process('send-reminders')
  async handle() {
    await this.reminder.sendDueReminders();
    this.logger.log('Abandoned cart reminder pass completed');
  }

  // docs/PRD-seller-conversations-inbox.md §۴.۵ — همان صف، job name جدا و cron کوتاه‌تر
  @Process('seller-conversation-followup')
  async handleSellerFollowUp() {
    const reminded = await this.sellerFollowUp.sendDueSellerReplyReminders();
    const returned = await this.sellerFollowUp.autoReturnStaleConversations();
    if (reminded || returned) {
      this.logger.log(
        `Seller conversation follow-up: reminded=${reminded} autoReturned=${returned}`,
      );
    }
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۲
  @Process('send-second-reminders')
  async handleSecond() {
    await this.reminder.sendDueSecondReminders();
    this.logger.log('Second abandoned cart reminder pass completed');
  }
}
