import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SalesAgentModule } from '../sales-agent/sales-agent.module';
import { StoreModule } from '../store/store.module';
import { MediaTranscodeModule } from '../../common/services/media-transcode.module';
import { AsrModule } from '../../common/services/asr.module';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import {
  TELEGRAM_UPDATES_QUEUE,
  TelegramUpdatesProcessor,
} from './telegram-updates.processor';

@Module({
  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — StoreModule مستقیم لازم است تا فروشنده از
  // تلگرام خودش جواب بدهد/رسید تایید کند (StoreService.sendSellerMessage/approveOrder/
  // rejectOrder/createTelegramConnectToken)؛ StoreModule خودش TelegramModule را import
  // نمی‌کند، پس چرخه‌ای ساخته نمی‌شود
  imports: [
    SalesAgentModule,
    StoreModule,
    MediaTranscodeModule,
    AsrModule,
    BullModule.registerQueue({ name: TELEGRAM_UPDATES_QUEUE }),
  ],
  controllers: [TelegramController],
  providers: [TelegramService, TelegramUpdatesProcessor],
  exports: [TelegramService],
})
export class TelegramModule {}
