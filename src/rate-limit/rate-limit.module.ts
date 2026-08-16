import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { RedisModule } from '../redis/redis.module';
import { RedisService } from '../redis/redis.service';
import { fa } from '../i18n/fa';
import { AppThrottlerGuard } from './app-throttler.guard';

const DEFAULT_GLOBAL_RATE_LIMIT = 120;
const DEFAULT_GLOBAL_RATE_WINDOW_SECONDS = 60;

@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) => ({
        throttlers: [
          {
            limit: Number(
              config.get(
                'GLOBAL_RATE_LIMIT',
                String(DEFAULT_GLOBAL_RATE_LIMIT),
              ),
            ),
            ttl:
              Number(
                config.get(
                  'GLOBAL_RATE_WINDOW_SECONDS',
                  String(DEFAULT_GLOBAL_RATE_WINDOW_SECONDS),
                ),
              ) * 1000,
          },
        ],
        storage: new ThrottlerStorageRedisService(redis),
        errorMessage: fa.errors.tooManyRequests,
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class RateLimitModule {}
