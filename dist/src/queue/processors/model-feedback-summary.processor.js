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
var ModelFeedbackSummaryProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelFeedbackSummaryProcessor = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const message_feedback_service_1 = require("../../modules/message-feedback/message-feedback.service");
let ModelFeedbackSummaryProcessor = ModelFeedbackSummaryProcessor_1 = class ModelFeedbackSummaryProcessor {
    messageFeedbackService;
    logger = new common_1.Logger(ModelFeedbackSummaryProcessor_1.name);
    constructor(messageFeedbackService) {
        this.messageFeedbackService = messageFeedbackService;
    }
    async handleSummarize() {
        const result = await this.messageFeedbackService.runSummary();
        this.logger.log(`Model feedback summary run: ${JSON.stringify(result)}`);
    }
};
exports.ModelFeedbackSummaryProcessor = ModelFeedbackSummaryProcessor;
__decorate([
    (0, bull_1.Process)('summarize'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ModelFeedbackSummaryProcessor.prototype, "handleSummarize", null);
exports.ModelFeedbackSummaryProcessor = ModelFeedbackSummaryProcessor = ModelFeedbackSummaryProcessor_1 = __decorate([
    (0, bull_1.Processor)('model-feedback-summary'),
    __metadata("design:paramtypes", [message_feedback_service_1.MessageFeedbackService])
], ModelFeedbackSummaryProcessor);
//# sourceMappingURL=model-feedback-summary.processor.js.map