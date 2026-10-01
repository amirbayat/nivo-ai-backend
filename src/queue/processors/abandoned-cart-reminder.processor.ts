import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { AbandonedCartReminderService } from '../../modules/sales-agent/abandoned-cart-reminder.service';

@Processor('abandoned-cart-reminder')
export class AbandonedCartReminderProcessor {
  private readonly logger = new Logger(AbandonedCartReminderProcessor.name);

  constructor(private readonly reminder: AbandonedCartReminderService) {}

  @Process('send-reminders')
  async handle() {
    await this.reminder.sendDueReminders();
    this.logger.log('Abandoned cart reminder pass completed');
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۲
  @Process('send-second-reminders')
  async handleSecond() {
    await this.reminder.sendDueSecondReminders();
    this.logger.log('Second abandoned cart reminder pass completed');
  }
}
