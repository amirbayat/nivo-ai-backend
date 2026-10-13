import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsModule } from '../notifications/notifications.module';
import { StoreCreditEngineModule } from '../store-credit-engine/store-credit-engine.module';
import { ExchangeRateModule } from '../../exchange-rate/exchange-rate.module';
import { OrderStateService } from './order-state.service';
import { OrderNotificationService } from './order-notification.service';
import { OrderExpiryService } from './order-expiry.service';
import { RefundService } from './refund.service';
import { ReceiptCheckService, RECEIPT_CHECK_QUEUE } from './receipt-check.service';
import { OrderOpsService } from './order-ops.service';
import { OrderPublicService } from './order-public.service';
import { OrderPublicController } from './order-public.controller';

@Module({
  imports: [
    NotificationsModule,
    StoreCreditEngineModule,
    ExchangeRateModule,
    BullModule.registerQueue({ name: RECEIPT_CHECK_QUEUE }),
  ],
  controllers: [OrderPublicController],
  providers: [
    OrderStateService,
    OrderNotificationService,
    OrderExpiryService,
    RefundService,
    ReceiptCheckService,
    OrderOpsService,
    OrderPublicService,
  ],
  exports: [
    OrderStateService,
    OrderNotificationService,
    OrderExpiryService,
    RefundService,
    ReceiptCheckService,
    OrderOpsService,
  ],
})
export class OrderLifecycleModule {}
