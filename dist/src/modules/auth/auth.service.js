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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const crypto = __importStar(require("crypto"));
const prisma_service_1 = require("../../prisma/prisma.service");
const redis_service_1 = require("../../redis/redis.service");
const sms_service_1 = require("../../sms/sms.service");
const campaign_service_1 = require("../campaign/campaign.service");
const fa_1 = require("../../i18n/fa");
const OTP_TTL = 120;
const OTP_RATE_LIMIT = 3;
const OTP_RATE_WINDOW = 600;
const OTP_ATTEMPT_LIMIT = 5;
const OTP_ATTEMPT_WINDOW = 1800;
function normalizePhone(phone) {
    return phone.replace(/^\+98/, '0').replace(/^98/, '0');
}
function otpKey(phone) { return `otp:${phone}`; }
function otpRateKey(phone) { return `otp:rate:${phone}`; }
function otpAttemptKey(phone) { return `otp:attempt:${phone}`; }
let AuthService = class AuthService {
    prisma;
    redis;
    jwt;
    config;
    sms;
    campaign;
    constructor(prisma, redis, jwt, config, sms, campaign) {
        this.prisma = prisma;
        this.redis = redis;
        this.jwt = jwt;
        this.config = config;
        this.sms = sms;
        this.campaign = campaign;
    }
    async sendOtp(rawPhone) {
        const phone = normalizePhone(rawPhone);
        const rateKey = otpRateKey(phone);
        const sends = await this.redis.incr(rateKey);
        if (sends === 1)
            await this.redis.expire(rateKey, OTP_RATE_WINDOW);
        if (sends > OTP_RATE_LIMIT) {
            throw new common_1.HttpException(fa_1.fa.auth.otpTooManyRequests, 429);
        }
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await this.redis.set(otpKey(phone), code, 'EX', OTP_TTL);
        await this.sms.sendOtp(phone, code);
        return { message: fa_1.fa.auth.otpSent };
    }
    async verifyOtp(rawPhone, code) {
        const phone = normalizePhone(rawPhone);
        const attemptKey = otpAttemptKey(phone);
        const attempts = await this.redis.incr(attemptKey);
        if (attempts === 1)
            await this.redis.expire(attemptKey, OTP_ATTEMPT_WINDOW);
        if (attempts > OTP_ATTEMPT_LIMIT) {
            throw new common_1.HttpException(fa_1.fa.auth.otpTooManyAttempts, 429);
        }
        const stored = await this.redis.get(otpKey(phone));
        if (!stored)
            throw new common_1.UnauthorizedException(fa_1.fa.auth.otpExpired);
        if (stored !== code)
            throw new common_1.UnauthorizedException(fa_1.fa.auth.otpInvalid);
        await this.redis.del(otpKey(phone), otpRateKey(phone), attemptKey);
        const existing = await this.prisma.user.findUnique({ where: { phone } });
        const user = existing ?? (await this.prisma.user.create({ data: { phone } }));
        const isNewUser = !existing;
        if (!user.isActive)
            throw new common_1.UnauthorizedException(fa_1.fa.auth.userDisabled);
        let waitlisted = null;
        if (isNewUser) {
            waitlisted = await this.campaign.applyToNewUser(user.id, user.phone);
        }
        const tokens = await this.issueTokens(user.id, user.phone, user.role);
        return {
            ...tokens,
            user: { id: user.id, phone: user.phone, role: user.role, name: user.name },
            waitlisted,
        };
    }
    async refresh(rawToken) {
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const stored = await this.prisma.refreshToken.findUnique({
            where: { tokenHash: hash },
            include: { user: true },
        });
        if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
            throw new common_1.UnauthorizedException(fa_1.fa.auth.refreshTokenInvalid);
        }
        if (!stored.user.isActive)
            throw new common_1.UnauthorizedException(fa_1.fa.auth.userDisabled);
        await this.prisma.refreshToken.update({
            where: { id: stored.id },
            data: { revokedAt: new Date() },
        });
        return this.issueTokens(stored.user.id, stored.user.phone, stored.user.role);
    }
    async logout(rawToken) {
        const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
        await this.prisma.refreshToken.updateMany({
            where: { tokenHash: hash },
            data: { revokedAt: new Date() },
        });
    }
    async getMe(userId) {
        return this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                phone: true,
                name: true,
                role: true,
                createdAt: true,
                subscription: {
                    select: {
                        status: true,
                        periodEnd: true,
                        plan: { select: { name: true, dailyFreeTokens: true, monthlyTotalTokens: true, allowedModels: true } },
                    },
                },
            },
        });
    }
    async issueTokens(userId, phone, role) {
        const payload = { sub: userId, phone, role };
        const accessToken = this.jwt.sign(payload, {
            secret: this.config.get('JWT_SECRET'),
            expiresIn: this.config.get('JWT_EXPIRES_IN'),
        });
        const refreshToken = crypto.randomBytes(40).toString('hex');
        const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        await this.prisma.refreshToken.create({
            data: { userId, tokenHash: hash, expiresAt },
        });
        return { accessToken, refreshToken };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        jwt_1.JwtService,
        config_1.ConfigService,
        sms_service_1.SmsService,
        campaign_service_1.CampaignService])
], AuthService);
//# sourceMappingURL=auth.service.js.map