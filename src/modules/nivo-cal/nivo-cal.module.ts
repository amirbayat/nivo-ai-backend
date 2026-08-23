import { Module } from '@nestjs/common';
import { NivoCalController } from './nivo-cal.controller';
import { NivoCalPublicController } from './nivo-cal-public.controller';
import { NivoCalService } from './nivo-cal.service';
import { UsageModule } from '../usage/usage.module';
import { ChatConfigModule } from '../chat-config/chat-config.module';
import { CreditsModule } from '../credits/credits.module';
import { LiaraModule } from '../liara/liara.module';

@Module({
  imports: [UsageModule, ChatConfigModule, CreditsModule, LiaraModule],
  controllers: [NivoCalController, NivoCalPublicController],
  providers: [NivoCalService],
})
export class NivoCalModule {}
