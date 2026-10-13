import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull';
import { NotificationDeliveryService } from '../../modules/notifications/notification-delivery.service';
import {
  NOTIFICATION_QUEUE,
  NotificationJob,
} from '../../modules/notifications/notification.types';

// docs/PRD-nivo-sales-unified.md 3.6 — retry/backoff در تنظیمات job (NotificationService)
@Processor(NOTIFICATION_QUEUE)
export class OrderNotificationProcessor {
  constructor(private readonly delivery: NotificationDeliveryService) {}

  @Process('deliver')
  async handle(job: Job<NotificationJob>) {
    await this.delivery.deliver(job.data);
  }
}
