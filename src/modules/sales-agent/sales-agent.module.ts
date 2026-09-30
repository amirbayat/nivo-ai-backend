import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StoreModule } from '../store/store.module';
import { MediaTranscodeModule } from '../../common/services/media-transcode.module';
import { AsrModule } from '../../common/services/asr.module';
import { UsageModule } from '../usage/usage.module';
import { TelegramApiClientModule } from '../telegram/telegram-api-client.module';
import { CommentsModule } from '../comments/comments.module';
import { SalesAgentController } from './sales-agent.controller';
import { SalesAgentService } from './sales-agent.service';
import { ConversationEngineService } from './conversation-engine.service';
import { CreditService } from './credit.service';
import { AbuseGuardService } from './abuse-guard.service';

@Module({
  imports: [
    StoreModule,
    MediaTranscodeModule,
    AsrModule,
    // docs/PRD-seller-credit-billing.md — CreditService از PricingService.calcCost استفاده می‌کند
    UsageModule,
    // docs/PRD-sales-agent-voice.md — مصرف‌کننده/پردازشگر واقعی در queue.module.ts
    BullModule.registerQueue({ name: 'sales-agent-voice' }),
    // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — پوش اعلان handoff/رسید به تلگرام فروشنده
    TelegramApiClientModule,
    // docs/PRD-customer-comments-and-discounts.md — ثبت نظر بعد از تکمیل سفارش + نمایش
    // نظرات تاییدشده در doFaq/showProduct
    CommentsModule,
  ],
  controllers: [SalesAgentController],
  providers: [
    SalesAgentService,
    ConversationEngineService,
    CreditService,
    AbuseGuardService,
  ],
  // CreditService هم از TelegramModule (handleStart) هم از QueueModule (voice processor) لازم است
  exports: [ConversationEngineService, CreditService],
})
export class SalesAgentModule {}
