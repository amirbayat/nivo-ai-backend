import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { ReceiptCheckService, RECEIPT_CHECK_QUEUE } from '../../modules/order-lifecycle/receipt-check.service';

@Processor(RECEIPT_CHECK_QUEUE)
export class ReceiptCheckProcessor {
  private readonly logger = new Logger(ReceiptCheckProcessor.name);

  constructor(private readonly checks: ReceiptCheckService) {}

  @Process('run')
  async handle(job: Job<{ orderId: string }>) {
    try {
      await this.checks.run(job.data.orderId);
    } catch (err) {
      this.logger.error(`receipt check failed (order=${job.data.orderId})`, err as Error);
      throw err;
    }
  }
}
