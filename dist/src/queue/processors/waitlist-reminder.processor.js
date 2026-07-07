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
var WaitlistReminderProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaitlistReminderProcessor = void 0;
const bull_1 = require("@nestjs/bull");
const common_1 = require("@nestjs/common");
const campaign_service_1 = require("../../modules/campaign/campaign.service");
let WaitlistReminderProcessor = WaitlistReminderProcessor_1 = class WaitlistReminderProcessor {
    campaign;
    logger = new common_1.Logger(WaitlistReminderProcessor_1.name);
    constructor(campaign) {
        this.campaign = campaign;
    }
    async handle() {
        await this.campaign.sendDueReminders();
        this.logger.log('Waitlist reminder pass completed');
    }
};
exports.WaitlistReminderProcessor = WaitlistReminderProcessor;
__decorate([
    (0, bull_1.Process)('send-reminders'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], WaitlistReminderProcessor.prototype, "handle", null);
exports.WaitlistReminderProcessor = WaitlistReminderProcessor = WaitlistReminderProcessor_1 = __decorate([
    (0, bull_1.Processor)('waitlist-reminder'),
    __metadata("design:paramtypes", [campaign_service_1.CampaignService])
], WaitlistReminderProcessor);
//# sourceMappingURL=waitlist-reminder.processor.js.map