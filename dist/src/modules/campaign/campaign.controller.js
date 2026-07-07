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
exports.AdminCampaignController = exports.WaitlistController = exports.CampaignPublicController = void 0;
const common_1 = require("@nestjs/common");
const jwt_guard_1 = require("../../common/guards/jwt.guard");
const admin_guard_1 = require("../../common/guards/admin.guard");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const campaign_service_1 = require("./campaign.service");
let CampaignPublicController = class CampaignPublicController {
    campaign;
    constructor(campaign) {
        this.campaign = campaign;
    }
    getStatus() {
        return this.campaign.getDisplayedCounter();
    }
};
exports.CampaignPublicController = CampaignPublicController;
__decorate([
    (0, common_1.Get)('status'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CampaignPublicController.prototype, "getStatus", null);
exports.CampaignPublicController = CampaignPublicController = __decorate([
    (0, common_1.Controller)('campaign'),
    __metadata("design:paramtypes", [campaign_service_1.CampaignService])
], CampaignPublicController);
let WaitlistController = class WaitlistController {
    campaign;
    constructor(campaign) {
        this.campaign = campaign;
    }
    getMyStatus(user) {
        return this.campaign.getMyWaitlistStatus(user.sub);
    }
    activate(token) {
        return this.campaign.activateByToken(token);
    }
};
exports.WaitlistController = WaitlistController;
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [current_user_decorator_1.JwtPayload]),
    __metadata("design:returntype", void 0)
], WaitlistController.prototype, "getMyStatus", null);
__decorate([
    (0, common_1.Post)('activate'),
    __param(0, (0, common_1.Body)('token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], WaitlistController.prototype, "activate", null);
exports.WaitlistController = WaitlistController = __decorate([
    (0, common_1.Controller)('waitlist'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard),
    __metadata("design:paramtypes", [campaign_service_1.CampaignService])
], WaitlistController);
let AdminCampaignController = class AdminCampaignController {
    campaign;
    constructor(campaign) {
        this.campaign = campaign;
    }
    list() {
        return this.campaign.listCampaigns();
    }
    create(body) {
        return this.campaign.createCampaign(body);
    }
    grantPhone(phone) {
        return this.campaign.grantAccessToPhone(phone);
    }
    update(id, body) {
        return this.campaign.updateCampaign(id, body);
    }
    close(id) {
        return this.campaign.closeCampaign(id);
    }
    getWaitlist(id, status) {
        return this.campaign.getWaitlist(id, status);
    }
    grant(id, mode) {
        return this.campaign.grantAccess(id, mode);
    }
};
exports.AdminCampaignController = AdminCampaignController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AdminCampaignController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AdminCampaignController.prototype, "create", null);
__decorate([
    (0, common_1.Post)('grant-phone'),
    __param(0, (0, common_1.Body)('phone')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminCampaignController.prototype, "grantPhone", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AdminCampaignController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':id/close'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AdminCampaignController.prototype, "close", null);
__decorate([
    (0, common_1.Get)(':id/waitlist'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], AdminCampaignController.prototype, "getWaitlist", null);
__decorate([
    (0, common_1.Post)(':id/grant'),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Body)('mode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AdminCampaignController.prototype, "grant", null);
exports.AdminCampaignController = AdminCampaignController = __decorate([
    (0, common_1.Controller)('admin/campaigns'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtGuard, admin_guard_1.AdminGuard),
    __metadata("design:paramtypes", [campaign_service_1.CampaignService])
], AdminCampaignController);
//# sourceMappingURL=campaign.controller.js.map