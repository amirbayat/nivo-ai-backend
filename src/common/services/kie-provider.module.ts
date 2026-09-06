import { Module } from '@nestjs/common';
import { KieProviderService } from './kie-provider.service';

@Module({
  providers: [KieProviderService],
  exports: [KieProviderService],
})
export class KieProviderModule {}
