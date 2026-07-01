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
exports.PlansService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const redis_service_1 = require("../../redis/redis.service");
const fa_1 = require("../../i18n/fa");
let PlansService = class PlansService {
    prisma;
    redis;
    constructor(prisma, redis) {
        this.prisma = prisma;
        this.redis = redis;
    }
    findAll() {
        return this.prisma.plan.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
        });
    }
    findAllAdmin() {
        return this.prisma.plan.findMany({
            orderBy: { sortOrder: 'asc' },
        });
    }
    async findOne(id) {
        const plan = await this.prisma.plan.findUnique({ where: { id } });
        if (!plan)
            throw new common_1.NotFoundException(fa_1.fa.plans.notFound);
        return plan;
    }
    create(dto) {
        return this.prisma.plan.create({
            data: {
                name: dto.name,
                priceMonthly: dto.priceMonthly,
                dailyFreeTokens: dto.dailyFreeTokens,
                monthlyTotalTokens: dto.monthlyTotalTokens,
                allowedModels: dto.allowedModels,
                features: (dto.features ?? {}),
                isActive: dto.isActive,
                sortOrder: dto.sortOrder,
                dailyMessageLimit: dto.dailyMessageLimit ?? null,
                ...(dto.maxInputTokens !== undefined && { maxInputTokens: dto.maxInputTokens }),
                ...(dto.outputThrottleSteps !== undefined && {
                    outputThrottleSteps: dto.outputThrottleSteps,
                }),
                ...(dto.throttledMessageCount !== undefined && { throttledMessageCount: dto.throttledMessageCount ?? null }),
                ...(dto.throttledInputTokens !== undefined && { throttledInputTokens: dto.throttledInputTokens ?? null }),
                ...(dto.throttledOutputTokens !== undefined && { throttledOutputTokens: dto.throttledOutputTokens ?? null }),
            },
        });
    }
    async update(id, dto) {
        await this.findOne(id);
        const { features, outputThrottleSteps, ...rest } = dto;
        const updated = await this.prisma.plan.update({
            where: { id },
            data: {
                ...rest,
                ...(features !== undefined && { features: features }),
                ...(outputThrottleSteps !== undefined && {
                    outputThrottleSteps: outputThrottleSteps,
                }),
            },
        });
        const subs = await this.prisma.subscription.findMany({
            where: { planId: id },
            select: { userId: true },
        });
        const delTasks = subs.map(s => this.redis.del(`plan:${s.userId}`));
        if (updated.priceMonthly === 0) {
            const keys = await this.redis.keys('plan:*');
            keys.forEach(k => delTasks.push(this.redis.del(k)));
        }
        if (delTasks.length)
            await Promise.all(delTasks);
        return updated;
    }
    async remove(id) {
        await this.findOne(id);
        return this.prisma.plan.delete({ where: { id } });
    }
};
exports.PlansService = PlansService;
exports.PlansService = PlansService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService])
], PlansService);
//# sourceMappingURL=plans.service.js.map