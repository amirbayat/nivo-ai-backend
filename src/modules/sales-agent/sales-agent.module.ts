import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StoreModule } from '../store/store.module';
import { MediaTranscodeModule } from '../../common/services/media-transcode.module';
import { AsrModule } from '../../common/services/asr.module';
import { SalesAgentController } from './sales-agent.controller';
import { SalesAgentService } from './sales-agent.service';
import { ConversationEngineService } from './conversation-engine.service';

@Module({
  imports: [
    StoreModule,
    MediaTranscodeModule,
    AsrModule,
    // docs/PRD-sales-agent-voice.md — مصرف‌کننده/پردازشگر واقعی در queue.module.ts
    BullModule.registerQueue({ name: 'sales-agent-voice' }),
  ],
  controllers: [SalesAgentController],
  providers: [SalesAgentService, ConversationEngineService],
  exports: [ConversationEngineService],
})
export class SalesAgentModule {}
