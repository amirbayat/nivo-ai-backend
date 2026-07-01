import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
export interface TokenCheckResult {
    allowed: boolean;
    source: 'free' | 'paid';
    remaining: number;
}
export interface ThrottleStep {
    afterMessages: number;
    maxOutputTokens: number;
}
export interface PlanLimits {
    dailyFreeTokens: number;
    monthlyTotalTokens: number;
    allowedModels: string[];
    maxInputTokens: number;
    outputThrottleSteps: ThrottleStep[];
    priceMonthly: number;
    planTier: string;
    planName: string;
}
export declare class TokenService {
    private readonly redis;
    private readonly prisma;
    private readonly config;
    constructor(redis: RedisService, prisma: PrismaService, config: ConfigService);
    checkQuota(userId: string, estimated?: number): Promise<TokenCheckResult>;
    increment(userId: string, tokens: number, source: 'free' | 'paid'): Promise<void>;
    getTodayRequestCount(userId: string): Promise<number>;
    resolveOutputThrottle(steps: ThrottleStep[], todayCount: number): number;
    resolveInputLimit(plan: PlanLimits): number;
    getUsageToday(userId: string): Promise<{
        freeUsed: number;
        freeLimit: number;
        paidUsed: number;
        paidLimit: number;
    }>;
    getUsageHistory(userId: string, month?: string): Promise<{
        date: string;
        freeTokensUsed: number;
        paidTokensUsed: number;
        requestsCount: number;
        costRial: number;
    }[]>;
    invalidatePlanCache(userId: string): Promise<void>;
    getCachedPlan(userId: string): Promise<PlanLimits>;
    private detectTier;
}
