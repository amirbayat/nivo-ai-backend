import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { LiveController } from './live.controller';
import { ShutdownService } from './shutdown.service';

@Module({
  controllers: [HealthController, LiveController],
  providers: [ShutdownService],
})
export class HealthModule {}
