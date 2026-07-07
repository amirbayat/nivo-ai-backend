"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueModule = void 0;
const common_1 = require("@nestjs/common");
const bull_1 = require("@nestjs/bull");
const config_1 = require("@nestjs/config");
const queue_service_1 = require("./queue.service");
const token_flush_processor_1 = require("./processors/token-flush.processor");
const feedback_summary_processor_1 = require("./processors/feedback-summary.processor");
const model_feedback_summary_processor_1 = require("./processors/model-feedback-summary.processor");
const waitlist_reminder_processor_1 = require("./processors/waitlist-reminder.processor");
const prisma_module_1 = require("../prisma/prisma.module");
const message_feedback_module_1 = require("../modules/message-feedback/message-feedback.module");
const campaign_module_1 = require("../modules/campaign/campaign.module");
let QueueModule = class QueueModule {
};
exports.QueueModule = QueueModule;
exports.QueueModule = QueueModule = __decorate([
    (0, common_1.Module)({
        imports: [
            bull_1.BullModule.forRootAsync({
                imports: [config_1.ConfigModule],
                inject: [config_1.ConfigService],
                useFactory: (config) => ({
                    redis: config.get('REDIS_URL'),
                }),
            }),
            bull_1.BullModule.registerQueue({ name: 'token-flush' }),
            bull_1.BullModule.registerQueue({ name: 'feedback-summary' }),
            bull_1.BullModule.registerQueue({ name: 'model-feedback-summary' }),
            bull_1.BullModule.registerQueue({ name: 'waitlist-reminder' }),
            prisma_module_1.PrismaModule,
            message_feedback_module_1.MessageFeedbackModule,
            campaign_module_1.CampaignModule,
        ],
        providers: [
            queue_service_1.QueueService,
            token_flush_processor_1.TokenFlushProcessor,
            feedback_summary_processor_1.FeedbackSummaryProcessor,
            model_feedback_summary_processor_1.ModelFeedbackSummaryProcessor,
            waitlist_reminder_processor_1.WaitlistReminderProcessor,
        ],
    })
], QueueModule);
//# sourceMappingURL=queue.module.js.map