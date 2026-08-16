import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ExchangeRateModule } from '../../exchange-rate/exchange-rate.module';
import { UsageModule } from '../usage/usage.module';
import { UsageAnalyticsModule } from '../usage-analytics/usage-analytics.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    TicketsModule,
    ExchangeRateModule,
    UsageModule,
    UsageAnalyticsModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
