import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ExchangeRateService } from '../../exchange-rate/exchange-rate.service';
export type BudgetWarningLevel = 'none' | 'warning' | 'critical' | 'session_limit' | 'exceeded';
export interface BudgetStatus {
    dailyBudgetRial: number;
    spentTodayRial: number;
    remainingTodayRial: number;
    monthlyBudgetRial: number;
    spentMonthRial: number;
    walletBalanceRial: number;
    warningLevel: BudgetWarningLevel;
    cascadeModel: string | null;
    upsellSuggestion: string | null;
    usdtRial: number;
}
export declare class PricingService {
    private readonly config;
    private readonly prisma;
    private readonly redis;
    private readonly exchangeRate;
    private readonly aiShare;
    private readonly warnPct;
    private readonly downgradePct;
    private readonly sessionLimitPct;
    private readonly freeBudgetRial;
    private readonly walletMarkup;
    private readonly modelPricing;
    constructor(config: ConfigService, prisma: PrismaService, redis: RedisService, exchangeRate: ExchangeRateService);
    calcCostRial(inputTokens: number, outputTokens: number, modelId: string): Promise<number>;
    dailyBudgetRial(priceMonthly: number): Promise<number>;
    monthlyBudgetRial(priceMonthly: number): Promise<number>;
    walletCostForRial(baseRial: number): number;
    trackCost(userId: string, costRial: number): Promise<void>;
    getSpentToday(userId: string): Promise<number>;
    getSpentMonth(userId: string): Promise<number>;
    getBudgetStatus(userId: string, priceMonthly: number, planTier: string): Promise<BudgetStatus>;
    assertBudget(userId: string, priceMonthly: number, planTier: string): Promise<{
        cascadeModel: string | null;
    }>;
    debitWallet(userId: string, costRial: number, description: string): Promise<boolean>;
    private upsellMessageFor;
}
