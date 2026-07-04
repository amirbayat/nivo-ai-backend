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
var ModelRouterService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelRouterService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_compatible_1 = require("@ai-sdk/openai-compatible");
const ai_1 = require("ai");
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const redis_service_1 = require("../../redis/redis.service");
const pricing_service_1 = require("../usage/pricing.service");
const CONFIG_CACHE_KEY = 'model_routing_config:cache';
const CONFIG_CACHE_TTL = 60;
const SINGLETON_ID = 'singleton';
const DEFAULT_SIMPLE_KEYWORDS = [
    'سلام',
    'خداحافظ',
    'ممنون',
    'مرسی',
    'باشه',
    'یعنی چی',
    'ترجمه کن',
    'کوتاه بگو',
];
const DEFAULT_COMPLEX_KEYWORDS = [
    'دیباگ',
    'معماری',
    'الگوریتم',
    'ثابت کن',
    'قدم به قدم',
    'تحلیل کن',
    'مقایسه کن',
    'بهینه‌سازی',
    'قرارداد',
    'کد کامل بنویس',
];
const TIER_RANK = {
    SIMPLE: 0,
    MEDIUM: 1,
    COMPLEX: 2,
};
let ModelRouterService = ModelRouterService_1 = class ModelRouterService {
    prisma;
    redis;
    config;
    pricingService;
    logger = new common_1.Logger(ModelRouterService_1.name);
    provider;
    constructor(prisma, redis, config, pricingService) {
        this.prisma = prisma;
        this.redis = redis;
        this.config = config;
        this.pricingService = pricingService;
        this.provider = (0, openai_compatible_1.createOpenAICompatible)({
            name: 'liara',
            baseURL: this.config.get('LIARA_AI_BASE_URL'),
            apiKey: this.config.get('LIARA_API_KEY'),
        });
    }
    async route(input) {
        const config = await this.getConfig();
        if (!config.enabled) {
            const modelId = input.manualModel ?? input.allowedModels[0];
            return {
                modelId,
                tier: client_1.ModelTier.MEDIUM,
                method: 'disabled',
                confidence: 1,
                overriddenManualModel: null,
            };
        }
        const { tier, method, confidence } = await this.classify(input, config);
        const candidates = await this.prisma.aiModel.findMany({
            where: {
                name: { in: input.allowedModels },
                isActive: true,
                ...(input.hasImages ? { supportsVision: true } : {}),
            },
            orderBy: { sortOrder: 'asc' },
        });
        if (!candidates.length) {
            return {
                modelId: input.manualModel ?? input.allowedModels[0],
                tier,
                method,
                confidence,
                overriddenManualModel: null,
            };
        }
        if (tier === client_1.ModelTier.SIMPLE) {
            const modelId = this.pickFromCandidates(candidates, client_1.ModelTier.SIMPLE);
            return {
                modelId,
                tier,
                method,
                confidence,
                overriddenManualModel: input.manualModel && input.manualModel !== modelId
                    ? input.manualModel
                    : null,
            };
        }
        if (input.manualModel &&
            candidates.some((c) => c.name === input.manualModel)) {
            return {
                modelId: input.manualModel,
                tier,
                method: 'manual',
                confidence: 1,
                overriddenManualModel: null,
            };
        }
        const modelId = this.pickFromCandidates(candidates, tier);
        return { modelId, tier, method, confidence, overriddenManualModel: null };
    }
    async log(input) {
        try {
            await this.prisma.modelRoutingLog.create({
                data: {
                    userId: input.userId,
                    conversationId: input.conversationId,
                    chosenModel: input.modelId,
                    tier: input.tier,
                    method: input.method,
                    confidence: input.confidence,
                    overrodeManual: input.overriddenManualModel,
                },
            });
        }
        catch (err) {
            this.logger.warn(`failed to write ModelRoutingLog: ${err.message}`);
        }
    }
    async invalidateConfigCache() {
        await this.redis.del(CONFIG_CACHE_KEY);
    }
    async getConfig() {
        const cached = await this.redis.get(CONFIG_CACHE_KEY);
        if (cached)
            return JSON.parse(cached);
        let row = await this.prisma.modelRoutingConfig.findFirst();
        if (!row) {
            row = await this.prisma.modelRoutingConfig.create({
                data: {
                    id: SINGLETON_ID,
                    simpleKeywords: DEFAULT_SIMPLE_KEYWORDS,
                    complexKeywords: DEFAULT_COMPLEX_KEYWORDS,
                },
            });
        }
        const shape = {
            enabled: row.enabled,
            simpleKeywords: row.simpleKeywords,
            complexKeywords: row.complexKeywords,
            complexLenThreshold: row.complexLenThreshold,
            llmFallbackEnabled: row.llmFallbackEnabled,
            llmFallbackModel: row.llmFallbackModel,
        };
        await this.redis.set(CONFIG_CACHE_KEY, JSON.stringify(shape), 'EX', CONFIG_CACHE_TTL);
        return shape;
    }
    async classify(input, config) {
        const heuristic = this.classifyHeuristic(input.content, config, input.lastAssistantMessageLength);
        if (heuristic.tier !== 'ambiguous') {
            return {
                tier: heuristic.tier,
                method: heuristic.method,
                confidence: heuristic.confidence,
            };
        }
        if (config.llmFallbackEnabled) {
            const llm = await this.classifyWithLLM(input.content, config.llmFallbackModel, input.userId);
            if (llm)
                return { tier: llm.tier, method: 'llm', confidence: llm.confidence };
        }
        return { tier: client_1.ModelTier.MEDIUM, method: 'heuristic', confidence: 0.5 };
    }
    classifyHeuristic(content, config, lastAssistantMessageLength) {
        if (lastAssistantMessageLength &&
            lastAssistantMessageLength > 800 &&
            content.length < 20) {
            return { tier: client_1.ModelTier.COMPLEX, method: 'sticky', confidence: 0.9 };
        }
        const hasCodeBlock = content.includes('```');
        const complexHits = countKeywordHits(content, config.complexKeywords);
        const simpleHits = countKeywordHits(content, config.simpleKeywords);
        if (content.length < 40 && complexHits === 0 && !hasCodeBlock) {
            return { tier: client_1.ModelTier.SIMPLE, method: 'heuristic', confidence: 0.85 };
        }
        if (hasCodeBlock ||
            complexHits >= 2 ||
            content.length > config.complexLenThreshold) {
            return { tier: client_1.ModelTier.COMPLEX, method: 'heuristic', confidence: 0.8 };
        }
        if (simpleHits > 0 && complexHits === 0 && content.length < 150) {
            return { tier: client_1.ModelTier.SIMPLE, method: 'heuristic', confidence: 0.7 };
        }
        return { tier: 'ambiguous', method: 'heuristic', confidence: 0 };
    }
    async classifyWithLLM(content, modelId, userId) {
        try {
            const { object, usage } = await (0, ai_1.generateObject)({
                model: this.provider(modelId),
                schema: zod_1.z.object({
                    tier: zod_1.z.enum(['SIMPLE', 'MEDIUM', 'COMPLEX']),
                    reason: zod_1.z.string().max(80),
                }),
                system: `این پیام کاربر را از نظر سختی طبقه‌بندی کن.
SIMPLE: احوال‌پرسی، سوال کوتاه واقعیت‌محور، ترجمه/بازنویسی کوتاه.
MEDIUM: نوشتن متن چندبندی، توضیح مفهوم، کد کوتاه.
COMPLEX: استدلال چندمرحله‌ای، کد/معماری پیچیده، تحلیل سند بلند، درخواست صریح تفکر عمیق.`,
                messages: [{ role: 'user', content: content.slice(0, 2000) }],
            });
            if (usage) {
                const costRial = await this.pricingService.calcCostRial(usage.inputTokens ?? 0, usage.outputTokens ?? 0, modelId);
                this.pricingService.trackCost(userId, costRial).catch(() => { });
            }
            return { tier: client_1.ModelTier[object.tier], confidence: 0.75 };
        }
        catch (err) {
            this.logger.warn(`classifier LLM call failed, falling back to MEDIUM: ${err.message}`);
            return null;
        }
    }
    pickFromCandidates(candidates, desiredTier) {
        const exact = candidates.filter((c) => c.tier === desiredTier);
        if (exact.length)
            return exact[0].name;
        const sorted = [...candidates].sort((a, b) => {
            const da = Math.abs(TIER_RANK[a.tier] - TIER_RANK[desiredTier]);
            const db = Math.abs(TIER_RANK[b.tier] - TIER_RANK[desiredTier]);
            return da - db || a.sortOrder - b.sortOrder;
        });
        return sorted[0].name;
    }
};
exports.ModelRouterService = ModelRouterService;
exports.ModelRouterService = ModelRouterService = ModelRouterService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        config_1.ConfigService,
        pricing_service_1.PricingService])
], ModelRouterService);
function countKeywordHits(text, keywords) {
    return keywords.reduce((n, k) => (text.includes(k) ? n + 1 : n), 0);
}
//# sourceMappingURL=model-router.service.js.map