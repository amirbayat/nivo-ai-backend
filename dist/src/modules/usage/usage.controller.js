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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageController = void 0;
const common_1 = require("@nestjs/common");
const jwt_guard_1 = require("../../common/guards/jwt.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const token_service_1 = require("./token.service");
const pricing_service_1 = require("./pricing.service");
let UsageController = class UsageController {
    tokenService;
    pricingService;
    constructor(tokenService, pricingService) {
        this.tokenService = tokenService;
        this.pricingService = pricingService;
    }
    getToday(user) {
        return this.tokenService.getUsageToday(user.sub);
    }
    getHistory(user, month) {
        return this.tokenService.getUsageHistory(user.sub, month);
    }
    async getBudget(user) {
        const plan = await this.tokenService.getCachedPlan(user.sub);
        return this.pricingService.getBudgetStatus(user.sub, plan.priceMonthly, plan.planTier);
    }
    async getMessageQuota(user) {
        const [plan, todayCount] = await Promise.all([
            this.tokenService.getCachedPlan(user.sub),
            this.tokenService.getTodayRequestCount(user.sub),
        ]);
        const N = plan.dailyMessageLimit;
        const M = plan.throttledMessageCount ?? 0;
        let stage = 'normal';
        if (N !== null) {
            if (todayCount >= N + M)
                stage = 'blocked';
            else if (todayCount >= N)
                stage = 'throttled';
        }
        const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;
        const iranNow = new Date(Date.now() + IRAN_OFFSET_MS);
        const iranMidnight = new Date(iranNow);
        iranMidnight.setUTCDate(iranMidnight.getUTCDate() + 1);
        iranMidnight.setUTCHours(0, 0, 0, 0);
        const resetAt = new Date(iranMidnight.getTime() - IRAN_OFFSET_MS);
        return {
            todayCount,
            N,
            M,
            stage,
            remainingNormal: N !== null ? Math.max(0, N - todayCount) : null,
            remainingThrottled: N !== null ? Math.max(0, N + M - todayCount) : null,
            throttledInputTokens: plan.throttledInputTokens,
            throttledOutputTokens: plan.throttledOutputTokens,
            resetAt: resetAt.toISOString(),
        };
    }
};
exports.UsageController = UsageController;
__decorate([
    (0, common_1.Get)('today'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [current_user_decorator_1.JwtPayload]),
    __metadata("design:returntype", void 0)
], UsageController.prototype, "getToday", null);
__decorate([
    (0, common_1.Get)('history'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Query)('month')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [current_user_decorator_1.JwtPayload, String]),
    __metadata("design:returntype", void 0)
], UsageController.prototype, "getHistory", null);
__decorate([
    (0, common_1.Get)('budget'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [current_user_decorator_1.JwtPayload]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "getBudget", null);
__decorate([
    (0, common_1.Get)('message-quota'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [current_user_decorator_1.JwtPayload]),
    __metadata("design:returntype", Promise)
], UsageController.prototype, "getMessageQuota", null);
exports.UsageController = UsageController = __decorate([
    (0, common_1.Controller)('usage'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard),
    __metadata("design:paramtypes", [token_service_1.TokenService,
        pricing_service_1.PricingService])
], UsageController);
//# sourceMappingURL=usage.controller.js.map