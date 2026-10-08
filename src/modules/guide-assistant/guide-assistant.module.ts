import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { UsageModule } from '../usage/usage.module';
import { KieProviderModule } from '../../common/services/kie-provider.module';
import { MediaTranscodeModule } from '../../common/services/media-transcode.module';
import { GuideAssistantController } from './guide-assistant.controller';
import { GuideAssistantService } from './guide-assistant.service';

@Module({
  imports: [StoreModule, UsageModule, KieProviderModule, MediaTranscodeModule],
  controllers: [GuideAssistantController],
  providers: [GuideAssistantService],
})
export class GuideAssistantModule {}
