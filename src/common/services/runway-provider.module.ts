import { Module } from '@nestjs/common';
import { RunwayProviderService } from './runway-provider.service';

@Module({
  providers: [RunwayProviderService],
  exports: [RunwayProviderService],
})
export class RunwayProviderModule {}
