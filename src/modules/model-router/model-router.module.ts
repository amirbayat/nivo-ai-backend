import { Module } from '@nestjs/common'
import { ModelRouterService } from './model-router.service'
import { ModelRoutingConfigController } from './model-routing-config.controller'
import { PrismaModule } from '../../prisma/prisma.module'
import { RedisModule } from '../../redis/redis.module'
import { UsageModule } from '../usage/usage.module'
import { LiveStatsModule } from '../live-stats/live-stats.module'

@Module({
  imports: [PrismaModule, RedisModule, UsageModule, LiveStatsModule],
  controllers: [ModelRoutingConfigController],
  providers: [ModelRouterService],
  exports: [ModelRouterService],
})
export class ModelRouterModule {}
