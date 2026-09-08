import { Module } from '@nestjs/common';
import { OpenRouterVideoProviderService } from './openrouter-video-provider.service';

@Module({
  providers: [OpenRouterVideoProviderService],
  exports: [OpenRouterVideoProviderService],
})
export class OpenRouterVideoProviderModule {}
