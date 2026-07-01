"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsageModule = void 0;
const common_1 = require("@nestjs/common");
const token_service_1 = require("./token.service");
const pricing_service_1 = require("./pricing.service");
const usage_controller_1 = require("./usage.controller");
const exchange_rate_module_1 = require("../../exchange-rate/exchange-rate.module");
let UsageModule = class UsageModule {
};
exports.UsageModule = UsageModule;
exports.UsageModule = UsageModule = __decorate([
    (0, common_1.Module)({
        imports: [exchange_rate_module_1.ExchangeRateModule],
        controllers: [usage_controller_1.UsageController],
        providers: [token_service_1.TokenService, pricing_service_1.PricingService],
        exports: [token_service_1.TokenService, pricing_service_1.PricingService],
    })
], UsageModule);
//# sourceMappingURL=usage.module.js.map