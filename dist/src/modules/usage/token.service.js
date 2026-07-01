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
exports.TokenService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const redis_service_1 = require("../../redis/redis.service");
const prisma_service_1 = require("../../prisma/prisma.service");
const fa_1 = require("../../i18n/fa");
function todayKey(userId) {
    const d = new Date().toISOString().slice(0, 10);
    return `token:free:${userId}:${d}`;
}
function monthKey(userId) {
    const m = new Date().toISOString().slice(0, 7);
    return `token:paid:${userId}:${m}`;
}
function dailyPaidKey(userId) {
    const d = new Date().toISOString().slice(0, 10);
    return `token:dailypaid:${userId}:${d}`;
}
function reqKey(userId) {
    const d = new Date().toISOString().slice(0, 10);
    return `token:req:${userId}:${d}`;
}
function planCacheKey(userId) {
    return `plan:${userId}`;
}
const TIER_INPUT_LIMITS = {
    free: 'MAX_INPUT_TOKENS_FREE',
    pro: 'MAX_INPUT_TOKENS_PRO',
    premium: 'MAX_INPUT_TOKENS_PREMIUM',
};
let TokenService = class TokenService {
    redis;
    prisma;
    config;
    constructor(redis, prisma, config) {
        this.redis = redis;
        this.prisma = prisma;
        this.config = config;
    }
    async checkQuota(userId, estimated = 500) {
        const plan = await this.getCachedPlan(userId);
        const [freeUsed, paidUsed] = await Promise.all([
            this.redis.get(todayKey(userId)).then(v => Number(v) || 0),
            this.redis.get(monthKey(userId)).then(v => Number(v) || 0),
        ]);
        const freeRemaining = plan.dailyFreeTokens - freeUsed;
        if (freeRemaining >= estimated) {
            return { allowed: true, source: 'free', remaining: freeRemaining };
        }
        const paidRemaining = plan.monthlyTotalTokens - paidUsed;
        if (paidRemaining >= estimated) {
            return { allowed: true, source: 'paid', remaining: paidRemaining };
        }
        throw new common_1.HttpException(fa_1.fa.chat.quotaExceeded, 429);
    }
    async increment(userId, tokens, source) {
        const rKey = reqKey(userId);
        if (source === 'free') {
            const fKey = todayKey(userId);
            await Promise.all([
                this.redis.incrby(fKey, tokens),
                this.redis.expire(fKey, 90_000, 'NX'),
                this.redis.incr(rKey),
                this.redis.expire(rKey, 90_000, 'NX'),
            ]);
        }
        else {
            const mKey = monthKey(userId);
            const dpKey = dailyPaidKey(userId);
            await Promise.all([
                this.redis.incrby(mKey, tokens),
                this.redis.expire(mKey, 2_764_800, 'NX'),
                this.redis.incrby(dpKey, tokens),
                this.redis.expire(dpKey, 90_000, 'NX'),
                this.redis.incr(rKey),
                this.redis.expire(rKey, 90_000, 'NX'),
            ]);
        }
    }
    async getTodayRequestCount(userId) {
        return this.redis.get(reqKey(userId)).then(v => Number(v) || 0);
    }
    resolveOutputThrottle(steps, todayCount) {
        if (!steps.length)
            return 4096;
        let limit = 4096;
        for (const step of steps) {
            if (todayCount >= step.afterMessages)
                limit = step.maxOutputTokens;
            else
                break;
        }
        return limit;
    }
    resolveInputLimit(plan) {
        const envKey = TIER_INPUT_LIMITS[plan.planTier];
        if (envKey) {
            const envVal = this.config.get(envKey);
            if (envVal)
                return Number(envVal);
        }
        return plan.maxInputTokens;
    }
    async getUsageToday(userId) {
        const plan = await this.getCachedPlan(userId);
        const [freeUsed, paidUsed] = await Promise.all([
            this.redis.get(todayKey(userId)).then(v => Number(v) || 0),
            this.redis.get(monthKey(userId)).then(v => Number(v) || 0),
        ]);
        return {
            freeUsed,
            freeLimit: plan.dailyFreeTokens,
            paidUsed,
            paidLimit: plan.monthlyTotalTokens,
        };
    }
    async getUsageHistory(userId, month) {
        const target = month ?? new Date().toISOString().slice(0, 7);
        const [year, mon] = target.split('-').map(Number);
        const start = new Date(year, mon - 1, 1);
        const end = new Date(year, mon, 1);
        const records = await this.prisma.dailyUsage.findMany({
            where: { userId, date: { gte: start, lt: end } },
            orderBy: { date: 'asc' },
            select: { date: true, freeTokensUsed: true, paidTokensUsed: true, requestsCount: true, costRial: true },
        });
        return records.map(r => ({
            date: r.date.toISOString().slice(0, 10),
            freeTokensUsed: r.freeTokensUsed,
            paidTokensUsed: r.paidTokensUsed,
            requestsCount: r.requestsCount,
            costRial: r.costRial,
        }));
    }
    async invalidatePlanCache(userId) {
        await this.redis.del(planCacheKey(userId));
    }
    async getCachedPlan(userId) {
        const cached = await this.redis.get(planCacheKey(userId));
        if (cached)
            return JSON.parse(cached);
        const sub = await this.prisma.subscription.findUnique({
            where: { userId },
            include: { plan: true },
        });
        let limits;
        if (sub?.plan) {
            const tier = this.detectTier(sub.plan.name, sub.plan.priceMonthly);
            limits = {
                dailyFreeTokens: sub.plan.dailyFreeTokens,
                monthlyTotalTokens: sub.plan.monthlyTotalTokens,
                allowedModels: sub.plan.allowedModels,
                maxInputTokens: sub.plan.maxInputTokens,
                outputThrottleSteps: sub.plan.outputThrottleSteps ?? [],
                priceMonthly: sub.plan.priceMonthly,
                planTier: tier,
                planName: sub.plan.name,
            };
        }
        else {
            limits = {
                dailyFreeTokens: 5000,
                monthlyTotalTokens: 0,
                allowedModels: ['openai/gpt-4o-mini'],
                maxInputTokens: Number(this.config.get('MAX_INPUT_TOKENS_FREE', '300')),
                outputThrottleSteps: [],
                priceMonthly: 0,
                planTier: 'free',
                planName: 'Free',
            };
        }
        await this.redis.set(planCacheKey(userId), JSON.stringify(limits), 'EX', 3600);
        return limits;
    }
    detectTier(planName, price) {
        const lower = planName.toLowerCase();
        if (lower.includes('premium') || lower.includes('ویژه'))
            return 'premium';
        if (lower.includes('pro') || lower.includes('حرفه'))
            return 'pro';
        if (price === 0)
            return 'free';
        return 'pro';
    }
};
exports.TokenService = TokenService;
exports.TokenService = TokenService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [redis_service_1.RedisService,
        prisma_service_1.PrismaService,
        config_1.ConfigService])
], TokenService);
//# sourceMappingURL=token.service.js.map