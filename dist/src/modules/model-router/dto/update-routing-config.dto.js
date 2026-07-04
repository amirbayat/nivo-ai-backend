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
exports.UpdateRoutingConfigDto = void 0;
const class_validator_1 = require("class-validator");
const fa_1 = require("../../../i18n/fa");
class UpdateRoutingConfigDto {
    enabled;
    simpleKeywords;
    complexKeywords;
    complexLenThreshold;
    llmFallbackEnabled;
    llmFallbackModel;
}
exports.UpdateRoutingConfigDto = UpdateRoutingConfigDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)({ message: fa_1.fa.validation.mustBeBoolean }),
    __metadata("design:type", Boolean)
], UpdateRoutingConfigDto.prototype, "enabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: fa_1.fa.validation.mustBeArray }),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], UpdateRoutingConfigDto.prototype, "simpleKeywords", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: fa_1.fa.validation.mustBeArray }),
    (0, class_validator_1.IsString)({ each: true }),
    __metadata("design:type", Array)
], UpdateRoutingConfigDto.prototype, "complexKeywords", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)({ message: fa_1.fa.validation.mustBeNumber }),
    (0, class_validator_1.Min)(0, { message: fa_1.fa.validation.numberPositive }),
    __metadata("design:type", Number)
], UpdateRoutingConfigDto.prototype, "complexLenThreshold", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)({ message: fa_1.fa.validation.mustBeBoolean }),
    __metadata("design:type", Boolean)
], UpdateRoutingConfigDto.prototype, "llmFallbackEnabled", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: fa_1.fa.validation.required }),
    __metadata("design:type", String)
], UpdateRoutingConfigDto.prototype, "llmFallbackModel", void 0);
//# sourceMappingURL=update-routing-config.dto.js.map