"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricingService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const redis_service_1 = require("../../redis/redis.service");
const exchange_rate_service_1 = require("../../exchange-rate/exchange-rate.service");
const ai_model_registry_service_1 = require("./ai-model-registry.service");
const fa_1 = require("../../i18n/fa");
function dailyCostKey(userId) {
    const d = new Date().toISOString().slice(0, 10);
    return `cost:daily:${userId}:${d}`;
}
function monthlyCostKey(userId) {
    const m = new Date().toISOString().slice(0, 7);
    return `cost:monthly:${userId}:${m}`;
}
let PricingService = class PricingService {
    config;
    prisma;
    redis;
    exchangeRate;
    modelRegistry;
    aiShare;
    warnPct;
    downgradePct;
    sessionLimitPct;
    freeBudgetRial;
    walletMarkup;
    constructor(config, prisma, redis, exchangeRate, modelRegistry) {
        this.config = config;
        this.prisma = prisma;
        this.redis = redis;
        this.exchangeRate = exchangeRate;
        this.modelRegistry = modelRegistry;
        this.aiShare = Number(this.config.get('AI_BUDGET_SHARE', '0.70'));
        this.warnPct = Number(this.config.get('BUDGET_WARN_PCT', '60')) / 100;
        this.downgradePct = Number(this.config.get('BUDGET_DOWNGRADE_PCT', '80')) / 100;
        this.sessionLimitPct = Number(this.config.get('BUDGET_SESSION_LIMIT_PCT', '90')) / 100;
        this.freeBudgetRial = Number(this.config.get('FREE_PLAN_MONTHLY_BUDGET_RIAL', '50000'));
        this.walletMarkup = Number(this.config.get('WALLET_MARKUP', '1.667'));
    }
    async calcCostRial(inputTokens, outputTokens, modelId) {
        const price = await this.modelRegistry.getModelInfo(modelId);
        const usdCost = (inputTokens * price.inputPricePerM + outputTokens * price.outputPricePerM) / 1_000_000;
        const rate = await this.exchangeRate.getUsdtRial();
        return Math.ceil(usdCost * rate);
    }
    async dailyBudgetRial(priceMonthly) {
        if (priceMonthly === 0)
            return Math.floor(this.freeBudgetRial / 30);
        return Math.floor((priceMonthly * this.aiShare) / 30);
    }
    async monthlyBudgetRial(priceMonthly) {
        if (priceMonthly === 0)
            return this.freeBudgetRial;
        return Math.floor(priceMonthly * this.aiShare);
    }
    walletCostForRial(baseRial) {
        return Math.ceil(baseRial * this.walletMarkup);
    }
    async trackCost(userId, costRial) {
        const dKey = dailyCostKey(userId);
        const mKey = monthlyCostKey(userId);
        await Promise.all([
            this.redis.incrby(dKey, costRial),
            this.redis.expire(dKey, 90_000, 'NX'),
            this.redis.incrby(mKey, costRial),
            this.redis.expire(mKey, 2_764_800, 'NX'),
        ]);
    }
    async getSpentToday(userId) {
        return this.redis.get(dailyCostKey(userId)).then(v => Number(v) || 0);
    }
    async getSpentMonth(userId) {
        return this.redis.get(monthlyCostKey(userId)).then(v => Number(v) || 0);
    }
    async getBudgetStatus(userId, priceMonthly, planTier) {
        const [dailyBudget, monthlyBudget, usdtRial] = await Promise.all([
            this.dailyBudgetRial(priceMonthly),
            this.monthlyBudgetRial(priceMonthly),
            this.exchangeRate.getUsdtRial(),
        ]);
        const [spentToday, spentMonth, wallet] = await Promise.all([
            this.getSpentToday(userId),
            this.getSpentMonth(userId),
            this.prisma.wallet.findUnique({ where: { userId }, select: { balanceRial: true } }),
        ]);
        const walletBalance = wallet?.balanceRial ?? 0;
        const ratio = dailyBudget > 0 ? spentToday / dailyBudget : 0;
        let warningLevel = 'none';
        let cascadeModel = null;
        let upsellSuggestion = null;
        if (ratio >= 1) {
            warningLevel = walletBalance > 0 ? 'warning' : 'exceeded';
            upsellSuggestion = this.upsellMessageFor(planTier);
        }
        else if (ratio >= this.sessionLimitPct) {
            warningLevel = 'session_limit';
            cascadeModel = 'openai/gpt-4o-mini';
            upsellSuggestion = this.upsellMessageFor(planTier);
        }
        else if (ratio >= this.downgradePct) {
            warningLevel = 'critical';
            cascadeModel = 'openai/gpt-4o-mini';
            upsellSuggestion = this.upsellMessageFor(planTier);
        }
        else if (ratio >= this.warnPct) {
            warningLevel = 'warning';
        }
        return {
            dailyBudgetRial: dailyBudget,
            spentTodayRial: spentToday,
            remainingTodayRial: Math.max(0, dailyBudget - spentToday),
            monthlyBudgetRial: monthlyBudget,
            spentMonthRial: spentMonth,
            walletBalanceRial: walletBalance,
            warningLevel,
            cascadeModel,
            upsellSuggestion,
            usdtRial,
        };
    }
    async assertBudget(userId, priceMonthly, planTier) {
        const status = await this.getBudgetStatus(userId, priceMonthly, planTier);
        if (status.warningLevel === 'exceeded') {
            throw new common_1.HttpException(fa_1.fa.chat.budgetExceeded, 429);
        }
        if (status.warningLevel === 'session_limit' && status.walletBalanceRial === 0) {
            throw new common_1.HttpException(fa_1.fa.budget.sessionLimit, 429);
        }
        return { cascadeModel: status.cascadeModel };
    }
    async debitWallet(userId, costRial, description) {
        const walletCost = this.walletCostForRial(costRial);
        const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
        if (!wallet || wallet.balanceRial < walletCost)
            return false;
        await this.prisma.$transaction([
            this.prisma.wallet.update({
                where: { userId },
                data: { balanceRial: { decrement: walletCost } },
            }),
            this.prisma.walletTransaction.create({
                data: { walletId: wallet.id, type: 'DEBIT', amountRial: walletCost, description },
            }),
        ]);
        return true;
    }
    upsellMessageFor(planTier) {
        if (planTier === 'free')
            return fa_1.fa.upsell.free;
        if (planTier === 'pro')
            return fa_1.fa.upsell.pro;
        return fa_1.fa.upsell.premium;
    }
};
exports.PricingService = PricingService;
exports.PricingService = PricingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        exchange_rate_service_1.ExchangeRateService,
        ai_model_registry_service_1.AiModelRegistryService])
], PricingService);
//# sourceMappingURL=pricing.service.js.map