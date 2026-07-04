"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelRouterModule = void 0;
const common_1 = require("@nestjs/common");
const model_router_service_1 = require("./model-router.service");
const model_routing_config_controller_1 = require("./model-routing-config.controller");
const prisma_module_1 = require("../../prisma/prisma.module");
const redis_module_1 = require("../../redis/redis.module");
const usage_module_1 = require("../usage/usage.module");
let ModelRouterModule = class ModelRouterModule {
};
exports.ModelRouterModule = ModelRouterModule;
exports.ModelRouterModule = ModelRouterModule = __decorate([
    (0, common_1.Module)({
        imports: [prisma_module_1.PrismaModule, redis_module_1.RedisModule, usage_module_1.UsageModule],
        controllers: [model_routing_config_controller_1.ModelRoutingConfigController],
        providers: [model_router_service_1.ModelRouterService],
        exports: [model_router_service_1.ModelRouterService],
    })
], ModelRouterModule);
//# sourceMappingURL=model-router.module.js.map