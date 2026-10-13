import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { OrderOpsService } from '../../modules/order-lifecycle/order-ops.service';

@Processor('order-ops')
export class OrderOpsProcessor {
  private readonly logger = new Logger(OrderOpsProcessor.name);

  constructor(private readonly ops: OrderOpsService) {}

  @Process('run')
  async handle() {
    try {
      await this.ops.run();
    } catch (err) {
      this.logger.error('order ops pass failed', err as Error);
      throw err;
    }
  }
}
