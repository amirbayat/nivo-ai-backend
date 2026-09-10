import { Module } from '@nestjs/common';
import { VeoProviderService } from './veo-provider.service';

@Module({
  providers: [VeoProviderService],
  exports: [VeoProviderService],
})
export class VeoProviderModule {}
