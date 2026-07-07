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
exports.AiModelRegistryService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const redis_service_1 = require("../../redis/redis.service");
const FALLBACK = {
    inputPricePerM: 0.15,
    outputPricePerM: 0.6,
    tokenizerFamily: 'o200k_base',
    avgCharsPerToken: 4,
};
function cacheKey(modelId) {
    return `ai_model:${modelId}`;
}
let AiModelRegistryService = class AiModelRegistryService {
    prisma;
    redis;
    constructor(prisma, redis) {
        this.prisma = prisma;
        this.redis = redis;
    }
    async getModelInfo(modelId) {
        const cached = await this.redis.get(cacheKey(modelId));
        if (cached)
            return JSON.parse(cached);
        const model = await this.prisma.aiModel.findUnique({
            where: { name: modelId },
            select: {
                inputPricePerM: true,
                outputPricePerM: true,
                tokenizerFamily: true,
                avgCharsPerToken: true,
            },
        });
        const info = model
            ? {
                inputPricePerM: model.inputPricePerM,
                outputPricePerM: model.outputPricePerM,
                tokenizerFamily: model.tokenizerFamily,
                avgCharsPerToken: model.avgCharsPerToken,
            }
            : FALLBACK;
        await this.redis.set(cacheKey(modelId), JSON.stringify(info), 'EX', 300);
        return info;
    }
    async invalidate(modelId) {
        await this.redis.del(cacheKey(modelId));
    }
};
exports.AiModelRegistryService = AiModelRegistryService;
exports.AiModelRegistryService = AiModelRegistryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService])
], AiModelRegistryService);
//# sourceMappingURL=ai-model-registry.service.js.map