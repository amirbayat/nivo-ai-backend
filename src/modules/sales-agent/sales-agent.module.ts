import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StoreModule } from '../store/store.module';
import { MediaTranscodeModule } from '../../common/services/media-transcode.module';
import { AsrModule } from '../../common/services/asr.module';
import { UsageModule } from '../usage/usage.module';
import { SalesAgentController } from './sales-agent.controller';
import { SalesAgentService } from './sales-agent.service';
import { ConversationEngineService } from './conversation-engine.service';
import { CreditService } from './credit.service';

@Module({
  imports: [
    StoreModule,
    MediaTranscodeModule,
    AsrModule,
    // docs/PRD-seller-credit-billing.md — CreditService از PricingService.calcCost استفاده می‌کند
    UsageModule,
    // docs/PRD-sales-agent-voice.md — مصرف‌کننده/پردازشگر واقعی در queue.module.ts
    BullModule.registerQueue({ name: 'sales-agent-voice' }),
  ],
  controllers: [SalesAgentController],
  providers: [SalesAgentService, ConversationEngineService, CreditService],
  // CreditService هم از TelegramModule (handleStart) هم از QueueModule (voice processor) لازم است
  exports: [ConversationEngineService, CreditService],
})
export class SalesAgentModule {}
