import { Module } from '@nestjs/common';
import { SalesAgentModule } from '../sales-agent/sales-agent.module';
import { MediaTranscodeModule } from '../../common/services/media-transcode.module';
import { AsrModule } from '../../common/services/asr.module';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';

@Module({
  imports: [SalesAgentModule, MediaTranscodeModule, AsrModule],
  controllers: [TelegramController],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
