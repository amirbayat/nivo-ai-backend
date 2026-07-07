"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CampaignService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const prisma_service_1 = require("../../prisma/prisma.service");
const redis_service_1 = require("../../redis/redis.service");
const config_1 = require("@nestjs/config");
const sms_service_1 = require("../../sms/sms.service");
const fa_1 = require("../../i18n/fa");
const ACTIVE_CAMPAIGN_CACHE_KEY = 'campaign:active';
const ACTIVE_CAMPAIGN_CACHE_TTL = 60;
const WAITING_LIMIT_CACHE_TTL = 120;
function iranToday() {
    return new Date(new Date().toISOString().slice(0, 10));
}
function hashToInt(input) {
    let h = 0;
    for (let i = 0; i < input.length; i++) {
        h = (h << 5) - h + input.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h);
}
let CampaignService = class CampaignService {
    prisma;
    redis;
    config;
    sms;
    constructor(prisma, redis, config, sms) {
        this.prisma = prisma;
        this.redis = redis;
        this.config = config;
        this.sms = sms;
    }
    async getActiveCampaign() {
        const cached = await this.redis.get(ACTIVE_CAMPAIGN_CACHE_KEY);
        if (cached)
            return cached === 'null' ? null : this.reviveCampaignDates(JSON.parse(cached));
        const campaign = await this.prisma.launchCampaign.findFirst({ where: { status: 'ACTIVE' } });
        await this.redis.set(ACTIVE_CAMPAIGN_CACHE_KEY, campaign ? JSON.stringify(campaign) : 'null', 'EX', ACTIVE_CAMPAIGN_CACHE_TTL);
        return campaign;
    }
    reviveCampaignDates(raw) {
        return {
            ...raw,
            startAt: new Date(raw.startAt),
            endAt: raw.endAt ? new Date(raw.endAt) : null,
            createdAt: new Date(raw.createdAt),
        };
    }
    async invalidateActiveCampaignCache() {
        await this.redis.del(ACTIVE_CAMPAIGN_CACHE_KEY);
    }
    async applyToNewUser(userId, phone) {
        const campaign = await this.getActiveCampaign();
        if (!campaign || campaign.status !== 'ACTIVE')
            return null;
        if (campaign.endAt && campaign.endAt < new Date())
            return null;
        const rows = await this.prisma.$queryRaw `
      UPDATE launch_campaigns
      SET "grantedCount" = "grantedCount" + 1
      WHERE id = ${campaign.id} AND status = 'ACTIVE' AND "grantedCount" < capacity
      RETURNING "grantedCount"
    `;
        if (rows.length > 0) {
            await this.invalidateActiveCampaignCache();
            return null;
        }
        const waitingCount = campaign.maxWaitlistSize !== null
            ? await this.prisma.waitlistEntry.count({ where: { campaignId: campaign.id, status: 'WAITING' } })
            : 0;
        const waitlistIsFull = campaign.maxWaitlistSize !== null && waitingCount >= campaign.maxWaitlistSize;
        const entry = await this.prisma.waitlistEntry.create({
            data: { campaignId: campaign.id, userId, phone, activationToken: crypto.randomBytes(24).toString('hex') },
        });
        const queuePosition = await this.prisma.waitlistEntry.count({
            where: { campaignId: campaign.id, status: 'WAITING', createdAt: { lte: entry.createdAt } },
        });
        const message = waitlistIsFull && campaign.waitlistFullMessage ? campaign.waitlistFullMessage : campaign.waitlistMessage;
        return { message, queuePosition };
    }
    async getWaitingDailyLimit(userId) {
        const cacheKey = this.waitingLimitCacheKey(userId);
        const cached = await this.redis.get(cacheKey);
        if (cached)
            return cached === 'null' ? null : Number(cached);
        const entry = await this.prisma.waitlistEntry.findUnique({
            where: { userId },
            include: { campaign: true },
        });
        const limit = entry && entry.status === 'WAITING' ? entry.campaign.waitlistDailyMessageLimit : null;
        await this.redis.set(cacheKey, limit === null ? 'null' : String(limit), 'EX', WAITING_LIMIT_CACHE_TTL);
        return limit;
    }
    waitingLimitCacheKey(userId) {
        return `waitlist:limit:${userId}`;
    }
    async invalidateWaitingLimitCache(userId) {
        await this.redis.del(this.waitingLimitCacheKey(userId));
    }
    async getDisplayedCounter() {
        const campaign = await this.getActiveCampaign();
        if (!campaign || !campaign.displayCounterEnabled) {
            return { active: Boolean(campaign), campaignName: campaign?.name ?? null, displayedRemaining: null };
        }
        const initial = Math.ceil((campaign.capacity * campaign.displayInitialPct) / 100);
        const tickMs = campaign.displayTickSeconds * 1000;
        const tickIndex = Math.floor((Date.now() - campaign.startAt.getTime()) / tickMs);
        let remaining = initial;
        for (let i = 0; i < tickIndex && remaining > campaign.displayFloor; i++) {
            const seed = hashToInt(`${campaign.id}:${i}`);
            const range = campaign.displayDecrementMax - campaign.displayDecrementMin + 1;
            const dec = campaign.displayDecrementMin + (seed % range);
            remaining -= dec;
        }
        remaining = Math.max(campaign.displayFloor, remaining);
        return { active: true, campaignName: campaign.name, displayedRemaining: remaining };
    }
    async getMyWaitlistStatus(userId) {
        const entry = await this.prisma.waitlistEntry.findUnique({ where: { userId } });
        if (!entry)
            return null;
        if (entry.status !== 'WAITING')
            return { status: entry.status, queuePosition: null };
        const position = await this.prisma.waitlistEntry.count({
            where: { campaignId: entry.campaignId, status: 'WAITING', createdAt: { lte: entry.createdAt } },
        });
        return { status: entry.status, queuePosition: position };
    }
    async activateByToken(token) {
        const entry = await this.prisma.waitlistEntry.findUnique({ where: { activationToken: token } });
        if (!entry)
            throw new common_1.NotFoundException(fa_1.fa.waitlist.invalidToken);
        if (entry.status === 'GRANTED') {
            await this.prisma.waitlistEntry.update({
                where: { id: entry.id },
                data: { status: 'ACTIVATED', activatedAt: new Date() },
            });
            await this.invalidateWaitingLimitCache(entry.userId);
        }
    }
    async grantAccess(campaignId, mode) {
        const entries = await this.prisma.waitlistEntry.findMany({
            where: { campaignId, status: 'WAITING' },
            orderBy: { createdAt: 'asc' },
            take: mode === 'all' ? undefined : mode,
        });
        await this.grantEntries(entries);
        return { granted: entries.length };
    }
    async grantAccessToPhone(phone) {
        const entry = await this.prisma.waitlistEntry.findFirst({ where: { phone, status: 'WAITING' } });
        if (!entry)
            return { granted: false };
        await this.grantEntries([entry]);
        return { granted: true };
    }
    async grantEntries(entries) {
        const appUrl = this.config.get('APP_URL');
        for (const entry of entries) {
            const campaign = await this.prisma.launchCampaign.findUnique({ where: { id: entry.campaignId } });
            await this.prisma.waitlistEntry.update({
                where: { id: entry.id },
                data: { status: 'GRANTED', grantedAt: new Date() },
            });
            await this.invalidateWaitingLimitCache(entry.userId);
            if (campaign?.grantedSmsTemplate) {
                const link = `${appUrl}/login?wl=${entry.activationToken}`;
                this.sms.sendByTemplate(entry.phone, campaign.grantedSmsTemplate, { token: link }).catch(() => { });
            }
        }
    }
    async sendDueReminders() {
        const granted = await this.prisma.waitlistEntry.findMany({
            where: { status: 'GRANTED' },
            include: { campaign: true },
        });
        for (const entry of granted) {
            const steps = entry.campaign.reminderSteps.sort((a, b) => a.dayOffset - b.dayOffset);
            if (!steps.length)
                continue;
            const daysSinceGrant = Math.floor((Date.now() - entry.grantedAt.getTime()) / 86_400_000);
            const nextStepIndex = (entry.lastReminderStepSent ?? -1) + 1;
            const nextStep = steps[nextStepIndex];
            if (!nextStep || daysSinceGrant < nextStep.dayOffset)
                continue;
            await this.sms.sendByTemplate(entry.phone, nextStep.template).catch(() => { });
            await this.prisma.waitlistEntry.update({
                where: { id: entry.id },
                data: { lastReminderStepSent: nextStepIndex, lastReminderSentAt: new Date() },
            });
        }
    }
    async listCampaigns() {
        return this.prisma.launchCampaign.findMany({ orderBy: { createdAt: 'desc' } });
    }
    async createCampaign(data) {
        const existingActive = await this.prisma.launchCampaign.findFirst({ where: { status: 'ACTIVE' } });
        if (existingActive) {
            await this.prisma.launchCampaign.update({ where: { id: existingActive.id }, data: { status: 'CLOSED' } });
        }
        const campaign = await this.prisma.launchCampaign.create({ data });
        await this.invalidateActiveCampaignCache();
        return campaign;
    }
    async updateCampaign(id, data) {
        const campaign = await this.prisma.launchCampaign.update({ where: { id }, data });
        await this.invalidateActiveCampaignCache();
        return campaign;
    }
    async closeCampaign(id) {
        const campaign = await this.prisma.launchCampaign.update({ where: { id }, data: { status: 'CLOSED' } });
        await this.invalidateActiveCampaignCache();
        return campaign;
    }
    async getWaitlist(campaignId, status) {
        return this.prisma.waitlistEntry.findMany({
            where: { campaignId, ...(status ? { status: status } : {}) },
            orderBy: { createdAt: 'asc' },
        });
    }
};
exports.CampaignService = CampaignService;
exports.CampaignService = CampaignService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        config_1.ConfigService,
        sms_service_1.SmsService])
], CampaignService);
//# sourceMappingURL=campaign.service.js.map