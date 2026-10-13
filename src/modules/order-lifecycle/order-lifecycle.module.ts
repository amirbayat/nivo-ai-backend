import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderStateService } from './order-state.service';
import { OrderNotificationService } from './order-notification.service';
import { OrderExpiryService } from './order-expiry.service';

// docs/PRD-nivo-sales-unified.md فاز ۳ — ماشین وضعیت سفارش (3.2)، اعلان‌های سفارش (3.7)، انقضا (3.10)
@Module({
  imports: [NotificationsModule],
  providers: [OrderStateService, OrderNotificationService, OrderExpiryService],
  exports: [OrderStateService, OrderNotificationService, OrderExpiryService],
})
export class OrderLifecycleModule {}
