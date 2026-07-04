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
exports.SubmitMessageFeedbackDto = void 0;
const class_validator_1 = require("class-validator");
const client_1 = require("@prisma/client");
const fa_1 = require("../../../i18n/fa");
class SubmitMessageFeedbackDto {
    vote;
    comment;
}
exports.SubmitMessageFeedbackDto = SubmitMessageFeedbackDto;
__decorate([
    (0, class_validator_1.IsEnum)(client_1.FeedbackVote, { message: fa_1.fa.validation.required }),
    __metadata("design:type", String)
], SubmitMessageFeedbackDto.prototype, "vote", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)({ message: fa_1.fa.validation.required }),
    (0, class_validator_1.MaxLength)(1000, { message: fa_1.fa.validation.stringTooLong }),
    __metadata("design:type", String)
], SubmitMessageFeedbackDto.prototype, "comment", void 0);
//# sourceMappingURL=submit-feedback.dto.js.map