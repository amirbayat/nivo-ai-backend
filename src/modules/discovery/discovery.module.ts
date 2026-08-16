import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryPublicController } from './discovery-public.controller';
import { DiscoveryGenerationService } from './discovery-generation.service';
import { DiscoveryAnonService } from './discovery-anon.service';
import { UsageModule } from '../usage/usage.module';
import { ChatConfigModule } from '../chat-config/chat-config.module';
import { LiaraModule } from '../liara/liara.module';
import { ImageGenerationModule } from '../../common/services/image-generation.module';
import { CreditsModule } from '../credits/credits.module';
import { AnonChatModule } from '../anon-chat/anon-chat.module';

@Module({
  imports: [
    UsageModule,
    ChatConfigModule,
    LiaraModule,
    ImageGenerationModule,
    CreditsModule,
    AnonChatModule,
  ],
  controllers: [DiscoveryController, DiscoveryPublicController],
  providers: [DiscoveryGenerationService, DiscoveryAnonService],
})
export class DiscoveryModule {}
