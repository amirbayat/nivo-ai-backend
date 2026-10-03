import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ProductEnrichmentReminderService } from '../../modules/store/product-enrichment-reminder.service';

@Processor('product-enrichment-reminder')
export class ProductEnrichmentReminderProcessor {
  private readonly logger = new Logger(ProductEnrichmentReminderProcessor.name);

  constructor(private readonly reminder: ProductEnrichmentReminderService) {}

  @Process('remind')
  async handle() {
    await this.reminder.sendDueReminders();
    this.logger.log('Product enrichment reminder pass completed');
  }
}
