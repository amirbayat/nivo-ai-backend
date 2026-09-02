import { Global, Module } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';

// Global مثل PrismaModule/RedisModule — AiProviderService باید در همه‌ی ماژول‌های AI (چت،
// discovery، sales، nivo-cal، فیدبک، ...) بدون افزودن دستی import به تک‌تک آن‌ها در دسترس باشد.
@Global()
@Module({
  providers: [AiProviderService],
  exports: [AiProviderService],
})
export class AiProviderModule {}
