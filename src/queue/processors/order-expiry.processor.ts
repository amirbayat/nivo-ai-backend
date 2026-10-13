import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { OrderExpiryService } from '../../modules/order-lifecycle/order-expiry.service';

// docs/PRD-nivo-sales-unified.md 3.10 — cron Bull (repeatable) انقضا/یادآوری سفارش پرداخت‌نشده
@Processor('order-expiry')
export class OrderExpiryProcessor {
  private readonly logger = new Logger(OrderExpiryProcessor.name);

  constructor(private readonly expiry: OrderExpiryService) {}

  @Process('run')
  async handle() {
    const r = await this.expiry.run();
    if (r.reminded || r.expired) {
      this.logger.log(
        `Order expiry pass: reminded=${r.reminded} expired=${r.expired}`,
      );
    }
  }
}
