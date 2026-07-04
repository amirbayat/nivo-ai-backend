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
var FeedbackSummaryProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeedbackSummaryProcessor = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const openai_compatible_1 = require("@ai-sdk/openai-compatible");
const ai_1 = require("ai");
const prisma_service_1 = require("../../prisma/prisma.service");
let FeedbackSummaryProcessor = FeedbackSummaryProcessor_1 = class FeedbackSummaryProcessor {
    prisma;
    config;
    logger = new common_1.Logger(FeedbackSummaryProcessor_1.name);
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
    async handleSummarize() {
        const previous = await this.prisma.feedbackSummary.findFirst({
            orderBy: { createdAt: 'desc' },
        });
        const unchecked = await this.prisma.feedback.findMany({
            where: { isChecked: false },
            take: 200,
            orderBy: { createdAt: 'asc' },
        });
        if (!unchecked.length) {
            this.logger.log('No unchecked feedbacks — skipping summary');
            return;
        }
        const feedbackLines = unchecked
            .map((f) => `[${f.category}] ${f.content}`)
            .join('\n');
        const previousContext = previous
            ? `Previous summary: ${previous.summary}\nPrevious top items: ${JSON.stringify(previous.topItems)}\n\n`
            : '';
        const prompt = `${previousContext}New user feedbacks:\n${feedbackLines}\n\nAnalyze these feedbacks and return ONLY valid JSON with this exact shape:\n{"summary":"2-3 sentence Persian summary","topItems":[{"title":"item title in Persian","count":number,"category":"CATEGORY"}]}\nReturn 5-10 top items. No markdown, no explanation, just JSON.`;
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
            parsed = { summary: text, topItems: [] };
        }
        const ids = unchecked.map((f) => f.id);
        await this.prisma.$transaction(async (tx) => {
            await tx.feedbackSummary.create({
                data: {
                    summary: parsed.summary,
                    topItems: parsed.topItems,
                    totalCount: unchecked.length + (previous?.totalCount ?? 0),
                    checkedUpTo: new Date(),
                },
            });
            await tx.feedback.updateMany({
                where: { id: { in: ids } },
                data: { isChecked: true },
            });
        });
        this.logger.log(`Feedback summary created — processed ${unchecked.length} feedbacks`);
    }
};
exports.FeedbackSummaryProcessor = FeedbackSummaryProcessor;
__decorate([
    (0, bull_1.Process)('summarize'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], FeedbackSummaryProcessor.prototype, "handleSummarize", null);
exports.FeedbackSummaryProcessor = FeedbackSummaryProcessor = FeedbackSummaryProcessor_1 = __decorate([
    (0, bull_1.Processor)('feedback-summary'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        config_1.ConfigService])
], FeedbackSummaryProcessor);
//# sourceMappingURL=feedback-summary.processor.js.map