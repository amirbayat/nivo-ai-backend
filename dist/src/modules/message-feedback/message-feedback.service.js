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
exports.MessageFeedbackService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_compatible_1 = require("@ai-sdk/openai-compatible");
const ai_1 = require("ai");
const prisma_service_1 = require("../../prisma/prisma.service");
const fa_1 = require("../../i18n/fa");
let MessageFeedbackService = class MessageFeedbackService {
    prisma;
    config;
    provider;
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.provider = (0, openai_compatible_1.createOpenAICompatible)({
            name: 'liara',
            baseURL: this.config.get('LIARA_AI_BASE_URL'),
            apiKey: this.config.get('LIARA_API_KEY'),
        });
    }
    async submit(userId, messageId, dto) {
        const message = await this.prisma.message.findUnique({
            where: { id: messageId },
            select: {
                id: true,
                role: true,
                model: true,
                conversation: { select: { userId: true } },
            },
        });
        if (!message)
            throw new common_1.NotFoundException(fa_1.fa.messageFeedback.notFound);
        if (message.conversation.userId !== userId)
            throw new common_1.ForbiddenException(fa_1.fa.errors.forbidden);
        if (message.role !== 'ASSISTANT')
            throw new common_1.BadRequestException(fa_1.fa.messageFeedback.onlyAssistant);
        const feedback = await this.prisma.messageFeedback.upsert({
            where: { messageId },
            create: {
                messageId,
                userId,
                vote: dto.vote,
                comment: dto.comment,
                modelUsed: message.model ?? 'unknown',
            },
            update: { vote: dto.vote, comment: dto.comment ?? null },
        });
        return { message: fa_1.fa.messageFeedback.submitted, vote: feedback.vote };
    }
    async getAll(page = 1, limit = 20, model, vote) {
        const skip = (page - 1) * limit;
        const where = {
            ...(model ? { modelUsed: model } : {}),
            ...(vote ? { vote } : {}),
        };
        const [items, total] = await Promise.all([
            this.prisma.messageFeedback.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { message: { select: { content: true } } },
            }),
            this.prisma.messageFeedback.count({ where }),
        ]);
        return { items, total, page, limit };
    }
    getSummary() {
        return this.prisma.modelFeedbackSummary.findFirst({
            orderBy: { createdAt: 'desc' },
        });
    }
    triggerSummary() {
        return this.runSummary();
    }
    async runSummary() {
        const previous = await this.prisma.modelFeedbackSummary.findFirst({
            orderBy: { createdAt: 'desc' },
        });
        const unchecked = await this.prisma.messageFeedback.findMany({
            where: { isChecked: false },
            take: 200,
            orderBy: { createdAt: 'asc' },
            include: { message: { select: { content: true } } },
        });
        if (!unchecked.length)
            return { message: fa_1.fa.messageFeedback.summaryNotReady };
        const lines = unchecked
            .map((f) => {
            const snippet = f.message.content.slice(0, 200);
            const note = f.comment ? ` | توضیح کاربر: ${f.comment}` : '';
            return `[مدل: ${f.modelUsed} | رأی: ${f.vote}] پیام: "${snippet}"${note}`;
        })
            .join('\n');
        const previousContext = previous
            ? `خلاصه‌ی قبلی: ${previous.summary}\nموارد قبلی: ${JSON.stringify(previous.topIssues)}\n\n`
            : '';
        const prompt = `${previousContext}بازخوردهای جدید کاربران روی پاسخ‌های مدل‌های هوش مصنوعی:
${lines}

این بازخوردها را تحلیل کن و فقط یک JSON معتبر با این ساختار برگردان:
{"summary":"۲-۳ جمله خلاصه‌ی فارسی از الگوهای کلی","topIssues":[{"model":"نام مدل","topic":"موضوع کوتاه پیام‌ها","downCount":عدد,"upCount":عدد,"sampleComments":["..."]}]}
حداکثر ۱۰ مورد در topIssues. تمرکز ویژه روی الگوهای تکراری در دیس‌لایک‌ها (کدام مدل برای چه نوع موضوعی بیشتر دیس‌لایک گرفته). هیچ متنی خارج از JSON ننویس.`;
        const modelId = this.config.get('SUMMARY_MODEL') ?? 'openai/gpt-4o-mini';
        const { text } = await (0, ai_1.generateText)({
            model: this.provider(modelId),
            prompt,
        });
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            parsed = { summary: text, topIssues: [] };
        }
        const ids = unchecked.map((f) => f.id);
        await this.prisma.$transaction([
            this.prisma.modelFeedbackSummary.create({
                data: {
                    summary: parsed.summary,
                    topIssues: parsed.topIssues,
                    totalProcessed: unchecked.length + (previous?.totalProcessed ?? 0),
                    checkedUpTo: new Date(),
                },
            }),
            this.prisma.messageFeedback.updateMany({
                where: { id: { in: ids } },
                data: { isChecked: true },
            }),
        ]);
        return {
            message: fa_1.fa.messageFeedback.submitted,
            processed: unchecked.length,
        };
    }
};
exports.MessageFeedbackService = MessageFeedbackService;
exports.MessageFeedbackService = MessageFeedbackService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], MessageFeedbackService);
//# sourceMappingURL=message-feedback.service.js.map