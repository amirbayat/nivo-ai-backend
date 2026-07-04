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
exports.ModelRoutingConfigController = void 0;
const common_1 = require("@nestjs/common");
const jwt_guard_1 = require("../../common/guards/jwt.guard");
const admin_guard_1 = require("../../common/guards/admin.guard");
const prisma_service_1 = require("../../prisma/prisma.service");
const model_router_service_1 = require("./model-router.service");
const update_routing_config_dto_1 = require("./dto/update-routing-config.dto");
const SINGLETON_ID = 'singleton';
function toUpdateData(dto) {
    const { simpleKeywords, complexKeywords, ...rest } = dto;
    return {
        ...rest,
        ...(simpleKeywords !== undefined && {
            simpleKeywords: simpleKeywords,
        }),
        ...(complexKeywords !== undefined && {
            complexKeywords: complexKeywords,
        }),
    };
}
let ModelRoutingConfigController = class ModelRoutingConfigController {
    prisma;
    modelRouter;
    constructor(prisma, modelRouter) {
        this.prisma = prisma;
        this.modelRouter = modelRouter;
    }
    async get() {
        const config = await this.prisma.modelRoutingConfig.findFirst();
        return (config ??
            this.prisma.modelRoutingConfig.create({ data: { id: SINGLETON_ID } }));
    }
    async update(dto) {
        const data = toUpdateData(dto);
        const existing = await this.prisma.modelRoutingConfig.findFirst();
        const updated = existing
            ? await this.prisma.modelRoutingConfig.update({
                where: { id: existing.id },
                data,
            })
            : await this.prisma.modelRoutingConfig.create({
                data: { id: SINGLETON_ID, ...data },
            });
        await this.modelRouter.invalidateConfigCache();
        return updated;
    }
};
exports.ModelRoutingConfigController = ModelRoutingConfigController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ModelRoutingConfigController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [update_routing_config_dto_1.UpdateRoutingConfigDto]),
    __metadata("design:returntype", Promise)
], ModelRoutingConfigController.prototype, "update", null);
exports.ModelRoutingConfigController = ModelRoutingConfigController = __decorate([
    (0, common_1.Controller)('admin/model-routing-config'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard, admin_guard_1.AdminGuard),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        model_router_service_1.ModelRouterService])
], ModelRoutingConfigController);
//# sourceMappingURL=model-routing-config.controller.js.map