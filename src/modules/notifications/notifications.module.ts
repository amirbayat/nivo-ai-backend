import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SmsModule } from '../../sms/sms.module';
import { TelegramApiClientModule } from '../telegram/telegram-api-client.module';
import { SellerBotApiClientModule } from '../seller-bot/seller-bot-api-client.module';
import { NotificationService } from './notification.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NOTIFICATION_QUEUE } from './notification.types';

// docs/PRD-nivo-sales-unified.md 3.6 / D-6 — پردازشگر Bull در queue.module.ts است
@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
    SmsModule,
    TelegramApiClientModule,
    SellerBotApiClientModule,
  ],
  providers: [NotificationService, NotificationDeliveryService],
  exports: [NotificationService, NotificationDeliveryService],
})
export class NotificationsModule {}
