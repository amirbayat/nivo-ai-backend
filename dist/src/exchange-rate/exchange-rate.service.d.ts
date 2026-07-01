import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
export declare class ExchangeRateService implements OnModuleInit, OnModuleDestroy {
    private readonly redis;
    private readonly config;
    private readonly logger;
    private readonly fallbackRate;
    private intervalId;
    constructor(redis: RedisService, config: ConfigService);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): void;
    getUsdtRial(): Promise<number>;
    private refresh;
}
