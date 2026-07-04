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
exports.MessageFeedbackController = void 0;
const common_1 = require("@nestjs/common");
const jwt_guard_1 = require("../../common/guards/jwt.guard");
const admin_guard_1 = require("../../common/guards/admin.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const message_feedback_service_1 = require("./message-feedback.service");
const submit_feedback_dto_1 = require("./dto/submit-feedback.dto");
let MessageFeedbackController = class MessageFeedbackController {
    messageFeedbackService;
    constructor(messageFeedbackService) {
        this.messageFeedbackService = messageFeedbackService;
    }
    submit(user, id, dto) {
        return this.messageFeedbackService.submit(user.sub, id, dto);
    }
    getAll(page, limit, model, vote) {
        const voteFilter = vote === 'UP' || vote === 'DOWN' ? vote : undefined;
        return this.messageFeedbackService.getAll(page ? Number(page) : 1, limit ? Number(limit) : 20, model, voteFilter);
    }
    getSummary() {
        return this.messageFeedbackService.getSummary();
    }
    triggerSummary() {
        return this.messageFeedbackService.triggerSummary();
    }
};
exports.MessageFeedbackController = MessageFeedbackController;
__decorate([
    (0, common_1.Post)('messages/:id/feedback'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [current_user_decorator_1.JwtPayload, String, submit_feedback_dto_1.SubmitMessageFeedbackDto]),
    __metadata("design:returntype", void 0)
], MessageFeedbackController.prototype, "submit", null);
__decorate([
    (0, common_1.Get)('admin/model-feedback'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard, admin_guard_1.AdminGuard),
    __param(0, (0, common_1.Query)('page')),
    __param(1, (0, common_1.Query)('limit')),
    __param(2, (0, common_1.Query)('model')),
    __param(3, (0, common_1.Query)('vote')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], MessageFeedbackController.prototype, "getAll", null);
__decorate([
    (0, common_1.Get)('admin/model-feedback/summary'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard, admin_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MessageFeedbackController.prototype, "getSummary", null);
__decorate([
    (0, common_1.Post)('admin/model-feedback/trigger'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard, admin_guard_1.AdminGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MessageFeedbackController.prototype, "triggerSummary", null);
exports.MessageFeedbackController = MessageFeedbackController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [message_feedback_service_1.MessageFeedbackService])
], MessageFeedbackController);
//# sourceMappingURL=message-feedback.controller.js.map