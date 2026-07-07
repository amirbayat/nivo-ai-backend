import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SmsService } from '../../sms/sms.service';
import { CampaignService } from '../campaign/campaign.service';
export declare class AuthService {
    private readonly prisma;
    private readonly redis;
    private readonly jwt;
    private readonly config;
    private readonly sms;
    private readonly campaign;
    constructor(prisma: PrismaService, redis: RedisService, jwt: JwtService, config: ConfigService, sms: SmsService, campaign: CampaignService);
    sendOtp(rawPhone: string): Promise<{
        message: string;
    }>;
    verifyOtp(rawPhone: string, code: string): Promise<{
        user: {
            id: string;
            phone: string;
            role: import("@prisma/client").$Enums.Role;
            name: string | null;
        };
        waitlisted: {
            message: string;
            queuePosition: number;
        } | null;
        accessToken: string;
        refreshToken: string;
    }>;
    refresh(rawToken: string): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
    logout(rawToken: string): Promise<void>;
    getMe(userId: string): Promise<{
        subscription: {
            plan: {
                name: string;
                dailyFreeTokens: number;
                monthlyTotalTokens: number;
                allowedModels: import("@prisma/client/runtime/client").JsonValue;
            };
            status: import("@prisma/client").$Enums.SubscriptionStatus;
            periodEnd: Date;
        } | null;
        name: string | null;
        id: string;
        createdAt: Date;
        phone: string;
        role: import("@prisma/client").$Enums.Role;
    } | null>;
    private issueTokens;
}
