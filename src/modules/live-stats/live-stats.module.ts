import { Module } from '@nestjs/common'
import { LiveStatsService } from './live-stats.service'
import { LiveStatsAdminController } from './live-stats-admin.controller'

@Module({
  controllers: [LiveStatsAdminController],
  providers: [LiveStatsService],
  exports: [LiveStatsService],
})
export class LiveStatsModule {}
