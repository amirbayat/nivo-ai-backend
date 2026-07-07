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
exports.ChatService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_compatible_1 = require("@ai-sdk/openai-compatible");
const ai_1 = require("ai");
const prisma_service_1 = require("../../prisma/prisma.service");
const redis_service_1 = require("../../redis/redis.service");
const token_service_1 = require("../usage/token.service");
const pricing_service_1 = require("../usage/pricing.service");
const token_estimator_service_1 = require("../usage/token-estimator.service");
const model_router_service_1 = require("../model-router/model-router.service");
const fa_1 = require("../../i18n/fa");
const OPTIMAL_MODE = 'optimal';
const PRE_ROUTING_REFERENCE_MODEL = 'openai/gpt-4o-mini';
const LEGACY_MODEL_MAP = {
    'gpt-4o-mini': 'openai/gpt-4o-mini',
    'gpt-4o': 'openai/gpt-4o',
    'gpt-4-turbo': 'openai/gpt-4-turbo',
};
function resolveModelId(id) {
    return LEGACY_MODEL_MAP[id] ?? id;
}
let ChatService = class ChatService {
    prisma;
    redis;
    tokenService;
    pricingService;
    tokenEstimator;
    modelRouter;
    config;
    provider;
    constructor(prisma, redis, tokenService, pricingService, tokenEstimator, modelRouter, config) {
        this.prisma = prisma;
        this.redis = redis;
        this.tokenService = tokenService;
        this.pricingService = pricingService;
        this.tokenEstimator = tokenEstimator;
        this.modelRouter = modelRouter;
        this.config = config;
        this.provider = (0, openai_compatible_1.createOpenAICompatible)({
            name: 'liara',
            baseURL: this.config.get('LIARA_AI_BASE_URL'),
            apiKey: this.config.get('LIARA_API_KEY'),
        });
    }
    async streamChat(conversationId, userId, dto, res) {
        const conversation = await this.prisma.conversation.findUnique({
            where: { id: conversationId },
            select: {
                userId: true,
                model: true,
                systemPrompt: true,
                title: true,
                contextSummary: true,
            },
        });
        if (!conversation)
            throw new common_1.NotFoundException(fa_1.fa.conversations.notFound);
        if (conversation.userId !== userId)
            throw new common_1.ForbiddenException(fa_1.fa.conversations.forbidden);
        const plan = await this.tokenService.getCachedPlan(userId);
        const manualLimitRaw = await this.redis.get(`manual_limit:${userId}`);
        if (manualLimitRaw) {
            const ml = JSON.parse(manualLimitRaw);
            const remaining = Math.ceil((ml.expiresAt - Date.now()) / 60_000);
            const msg = ml.reason
                ? `${ml.reason} (${remaining} دقیقه دیگر)`
                : `دسترسی شما توسط ادمین موقتاً محدود شده است (${remaining} دقیقه دیگر)`;
            throw new common_1.HttpException({ message: msg }, 429);
        }
        const todayCount = await this.tokenService.getTodayRequestCount(userId);
        const N = plan.dailyMessageLimit;
        const M = plan.throttledMessageCount ?? 0;
        let messageStage = 'normal';
        if (N !== null) {
            if (todayCount >= N + M) {
                throw new common_1.HttpException({
                    message: fa_1.fa.chat.dailyBlocked,
                    planTier: plan.planTier,
                    stage: 'blocked',
                }, 429);
            }
            if (todayCount >= N) {
                messageStage = 'throttled';
            }
        }
        let effectiveInputLimit = this.tokenService.resolveInputLimit(plan);
        if (messageStage === 'throttled' && plan.throttledInputTokens) {
            effectiveInputLimit = plan.throttledInputTokens;
        }
        const estimatedInput = await this.tokenEstimator.estimateTokens(dto.content, PRE_ROUTING_REFERENCE_MODEL);
        if (estimatedInput > effectiveInputLimit) {
            throw new common_1.BadRequestException(fa_1.fa.chat.inputTooLong(effectiveInputLimit));
        }
        const { cascadeModel } = await this.pricingService.assertBudget(userId, plan.priceMonthly, plan.planTier);
        const allowed = plan.allowedModels;
        if (allowed.length === 0)
            throw new common_1.ForbiddenException(fa_1.fa.chat.modelNotAllowed);
        const rawModelChoice = dto.model ?? conversation.model;
        const manualModel = rawModelChoice === OPTIMAL_MODE
            ? undefined
            : resolveModelId(rawModelChoice);
        const validManualModel = manualModel && allowed.includes(manualModel) ? manualModel : undefined;
        const lastAssistant = await this.prisma.message.findFirst({
            where: { conversationId, role: 'ASSISTANT' },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
        });
        const routed = await this.modelRouter.route({
            userId,
            content: dto.content,
            hasImages: Boolean(dto.images?.length),
            allowedModels: allowed,
            manualModel: validManualModel,
            lastAssistantMessageLength: lastAssistant?.content.length,
        });
        let modelId = routed.modelId;
        this.modelRouter.log({ userId, conversationId, ...routed }).catch(() => { });
        if (dto.images?.length) {
            const modelRecord = await this.prisma.aiModel.findFirst({
                where: { name: rawModelChoice, isActive: true },
                select: { supportsVision: true },
            });
            if (modelRecord && !modelRecord.supportsVision) {
                throw new common_1.BadRequestException('این مدل از تصویر پشتیبانی نمی‌کند. لطفاً یک مدل Vision‌دار انتخاب کنید.');
            }
        }
        const estimatedForQuota = await this.tokenEstimator.estimateTokens(dto.content, modelId);
        const quota = await this.tokenService.checkQuota(userId, estimatedForQuota);
        const throttledMax = this.tokenService.resolveOutputThrottle(plan.outputThrottleSteps, todayCount);
        let maxOut = Math.min(quota.remaining, throttledMax);
        if (messageStage === 'throttled' && plan.throttledOutputTokens) {
            maxOut = Math.min(maxOut, plan.throttledOutputTokens);
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        if (N !== null) {
            const remainingNormal = Math.max(0, N - todayCount);
            const remainingThrottled = Math.max(0, N + M - todayCount);
            res.write(`data: ${JSON.stringify({
                info: 'stage',
                stage: messageStage,
                remainingNormal,
                remainingThrottled,
            })}\n\n`);
        }
        if (cascadeModel) {
            modelId = cascadeModel;
            res.write(`data: ${JSON.stringify({ info: 'model_cascaded', model: cascadeModel })}\n\n`);
        }
        if (throttledMax < 4096) {
            res.write(`data: ${JSON.stringify({ info: 'output_throttled', maxOutputTokens: throttledMax })}\n\n`);
        }
        try {
            await this.prisma.message.create({
                data: {
                    conversationId,
                    role: 'USER',
                    content: dto.content,
                    ...(dto.images?.length ? { images: dto.images } : {}),
                },
            });
            const systemParts = [];
            if (conversation.systemPrompt)
                systemParts.push(conversation.systemPrompt);
            let recentMessages;
            if (conversation.contextSummary) {
                systemParts.push(`خلاصه مکالمه تا کنون:\n${conversation.contextSummary}`);
                recentMessages = await this.prisma.message.findMany({
                    where: { conversationId },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: { role: true, content: true },
                });
                recentMessages = recentMessages.reverse();
            }
            else {
                recentMessages = await this.prisma.message.findMany({
                    where: { conversationId },
                    orderBy: { createdAt: 'asc' },
                    take: 20,
                    select: { role: true, content: true },
                });
            }
            const hasImages = Boolean(dto.images?.length);
            const coreMessages = recentMessages.map((m, idx) => {
                const isLast = idx === recentMessages.length - 1;
                if (isLast && m.role === 'USER' && hasImages) {
                    const visionMsg = {
                        role: 'user',
                        content: [
                            ...dto.images.map((img) => ({
                                type: 'image',
                                image: img,
                            })),
                            { type: 'text', text: m.content },
                        ],
                    };
                    return visionMsg;
                }
                return {
                    role: m.role === 'USER'
                        ? 'user'
                        : m.role === 'ASSISTANT'
                            ? 'assistant'
                            : 'system',
                    content: m.content,
                };
            });
            const result = (0, ai_1.streamText)({
                model: this.provider(modelId),
                system: systemParts.join('\n\n') || undefined,
                messages: coreMessages,
                maxOutputTokens: maxOut,
            });
            let fullContent = '';
            const isFirstMessage = recentMessages.length === 1;
            for await (const chunk of result.textStream) {
                fullContent += chunk;
                res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
            }
            const usage = await result.usage;
            const tokensUsed = usage.totalTokens ?? 0;
            const costRial = await this.pricingService.calcCostRial(usage.inputTokens ?? 0, usage.outputTokens ?? 0, modelId);
            await this.prisma.message.create({
                data: {
                    conversationId,
                    role: 'ASSISTANT',
                    content: fullContent,
                    tokensInput: usage.inputTokens ?? 0,
                    tokensOutput: usage.outputTokens ?? 0,
                    model: modelId,
                },
            });
            await Promise.all([
                this.tokenService.increment(userId, tokensUsed, quota.source),
                this.pricingService.trackCost(userId, costRial),
                this.prisma.conversation.update({
                    where: { id: conversationId },
                    data: {
                        totalTokens: { increment: tokensUsed },
                        lastMessageAt: new Date(),
                    },
                }),
            ]);
            if (!conversation.title && isFirstMessage) {
                await this.generateTitle(conversationId, dto.content, modelId);
            }
            res.write(`data: [DONE]\n\n`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : fa_1.fa.chat.streamError;
            res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        }
        finally {
            res.end();
        }
    }
    async generateTitle(conversationId, firstMessage, modelId) {
        try {
            const { text } = await (0, ai_1.generateText)({
                model: this.provider(modelId),
                system: 'یک عنوان کوتاه (حداکثر ۵ کلمه) برای این مکالمه بنویس. فقط عنوان، بدون توضیح یا نقل‌قول.',
                messages: [{ role: 'user', content: firstMessage.slice(0, 300) }],
                maxOutputTokens: 40,
            });
            const title = text.trim().replace(/^["'«»\n]+|["'«»\n]+$/g, '');
            if (title) {
                await this.prisma.conversation.update({
                    where: { id: conversationId },
                    data: { title },
                });
            }
        }
        catch {
        }
    }
};
exports.ChatService = ChatService;
exports.ChatService = ChatService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        token_service_1.TokenService,
        pricing_service_1.PricingService,
        token_estimator_service_1.TokenEstimatorService,
        model_router_service_1.ModelRouterService,
        config_1.ConfigService])
], ChatService);
//# sourceMappingURL=chat.service.js.map