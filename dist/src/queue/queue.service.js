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
var QueueService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueService = void 0;
const common_1 = require("@nestjs/common");
const bull_1 = require("@nestjs/bull");
const FLUSH_CRON = '*/5 * * * *';
const SUMMARY_CRON = '0 2 * * *';
const MODEL_FEEDBACK_SUMMARY_CRON = '0 3 * * *';
const WAITLIST_REMINDER_CRON = '0 9 * * *';
let QueueService = QueueService_1 = class QueueService {
    tokenFlushQueue;
    feedbackSummaryQueue;
    modelFeedbackSummaryQueue;
    waitlistReminderQueue;
    logger = new common_1.Logger(QueueService_1.name);
    constructor(tokenFlushQueue, feedbackSummaryQueue, modelFeedbackSummaryQueue, waitlistReminderQueue) {
        this.tokenFlushQueue = tokenFlushQueue;
        this.feedbackSummaryQueue = feedbackSummaryQueue;
        this.modelFeedbackSummaryQueue = modelFeedbackSummaryQueue;
        this.waitlistReminderQueue = waitlistReminderQueue;
    }
    async onApplicationBootstrap() {
        const tokenRepeatables = await this.tokenFlushQueue.getRepeatableJobs();
        for (const job of tokenRepeatables) {
            await this.tokenFlushQueue.removeRepeatableByKey(job.key);
        }
        await this.tokenFlushQueue.add('flush', {}, { repeat: { cron: FLUSH_CRON } });
        this.logger.log(`Token flush job scheduled: ${FLUSH_CRON}`);
        const summaryRepeatables = await this.feedbackSummaryQueue.getRepeatableJobs();
        for (const job of summaryRepeatables) {
            await this.feedbackSummaryQueue.removeRepeatableByKey(job.key);
        }
        await this.feedbackSummaryQueue.add('summarize', {}, { repeat: { cron: SUMMARY_CRON } });
        this.logger.log(`Feedback summary job scheduled: ${SUMMARY_CRON}`);
        const modelFeedbackRepeatables = await this.modelFeedbackSummaryQueue.getRepeatableJobs();
        for (const job of modelFeedbackRepeatables) {
            await this.modelFeedbackSummaryQueue.removeRepeatableByKey(job.key);
        }
        await this.modelFeedbackSummaryQueue.add('summarize', {}, { repeat: { cron: MODEL_FEEDBACK_SUMMARY_CRON } });
        this.logger.log(`Model feedback summary job scheduled: ${MODEL_FEEDBACK_SUMMARY_CRON}`);
        const waitlistRepeatables = await this.waitlistReminderQueue.getRepeatableJobs();
        for (const job of waitlistRepeatables) {
            await this.waitlistReminderQueue.removeRepeatableByKey(job.key);
        }
        await this.waitlistReminderQueue.add('send-reminders', {}, { repeat: { cron: WAITLIST_REMINDER_CRON } });
        this.logger.log(`Waitlist reminder job scheduled: ${WAITLIST_REMINDER_CRON}`);
    }
};
exports.QueueService = QueueService;
exports.QueueService = QueueService = QueueService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bull_1.InjectQueue)('token-flush')),
    __param(1, (0, bull_1.InjectQueue)('feedback-summary')),
    __param(2, (0, bull_1.InjectQueue)('model-feedback-summary')),
    __param(3, (0, bull_1.InjectQueue)('waitlist-reminder')),
    __metadata("design:paramtypes", [Object, Object, Object, Object])
], QueueService);
//# sourceMappingURL=queue.service.js.map