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
exports.UpdatePlanDto = void 0;
const class_validator_1 = require("class-validator");
const fa_1 = require("../../../i18n/fa");
class UpdatePlanDto {
    name;
    priceMonthly;
    dailyFreeTokens;
    monthlyTotalTokens;
    allowedModels;
    features;
    isActive;
    sortOrder;
    dailyMessageLimit;
    maxInputTokens;
    outputThrottleSteps;
    throttledMessageCount;
    throttledInputTokens;
    throttledOutputTokens;
}
exports.UpdatePlanDto = UpdatePlanDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: fa_1.fa.validation.required }),
    (0, class_validator_1.MaxLength)(100, { message: fa_1.fa.validation.stringTooLong }),
    __metadata("design:type", String)
], UpdatePlanDto.prototype, "name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)({ message: fa_1.fa.validation.mustBeNumber }),
    (0, class_validator_1.Min)(0, { message: fa_1.fa.validation.numberPositive }),
    __metadata("design:type", Number)
], UpdatePlanDto.prototype, "priceMonthly", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)({ message: fa_1.fa.validation.mustBeNumber }),
    (0, class_validator_1.Min)(0, { message: fa_1.fa.validation.numberPositive }),
    __metadata("design:type", Number)
], UpdatePlanDto.prototype, "dailyFreeTokens", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)({ message: fa_1.fa.validation.mustBeNumber }),
    (0, class_validator_1.Min)(0, { message: fa_1.fa.validation.numberPositive }),
    __metadata("design:type", Number)
], UpdatePlanDto.prototype, "monthlyTotalTokens", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: fa_1.fa.validation.mustBeArray }),
    (0, class_validator_1.IsString)({ each: true, message: fa_1.fa.validation.required }),
    __metadata("design:type", Array)
], UpdatePlanDto.prototype, "allowedModels", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)({ message: fa_1.fa.validation.required }),
    __metadata("design:type", Object)
], UpdatePlanDto.prototype, "features", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)({ message: fa_1.fa.validation.mustBeBoolean }),
    __metadata("design:type", Boolean)
], UpdatePlanDto.prototype, "isActive", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)({ message: fa_1.fa.validation.mustBeNumber }),
    (0, class_validator_1.Min)(0, { message: fa_1.fa.validation.numberPositive }),
    __metadata("design:type", Number)
], UpdatePlanDto.prototype, "sortOrder", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)({ message: fa_1.fa.validation.mustBeNumber }),
    (0, class_validator_1.Min)(1, { message: fa_1.fa.validation.numberPositive }),
    __metadata("design:type", Object)
], UpdatePlanDto.prototype, "dailyMessageLimit", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)({ message: fa_1.fa.validation.mustBeNumber }),
    (0, class_validator_1.Min)(1, { message: fa_1.fa.validation.numberPositive }),
    __metadata("design:type", Number)
], UpdatePlanDto.prototype, "maxInputTokens", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)({ message: fa_1.fa.validation.mustBeArray }),
    __metadata("design:type", Array)
], UpdatePlanDto.prototype, "outputThrottleSteps", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)({ message: fa_1.fa.validation.mustBeNumber }),
    (0, class_validator_1.Min)(0, { message: fa_1.fa.validation.numberPositive }),
    __metadata("design:type", Object)
], UpdatePlanDto.prototype, "throttledMessageCount", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)({ message: fa_1.fa.validation.mustBeNumber }),
    (0, class_validator_1.Min)(1, { message: fa_1.fa.validation.numberPositive }),
    __metadata("design:type", Object)
], UpdatePlanDto.prototype, "throttledInputTokens", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)({ message: fa_1.fa.validation.mustBeNumber }),
    (0, class_validator_1.Min)(1, { message: fa_1.fa.validation.numberPositive }),
    __metadata("design:type", Object)
], UpdatePlanDto.prototype, "throttledOutputTokens", void 0);
//# sourceMappingURL=update-plan.dto.js.map