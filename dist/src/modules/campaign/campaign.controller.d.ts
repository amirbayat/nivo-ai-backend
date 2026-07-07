import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { CampaignService } from './campaign.service';
export declare class CampaignPublicController {
    private readonly campaign;
    constructor(campaign: CampaignService);
    getStatus(): Promise<import("./campaign.service").DisplayedCounter>;
}
export declare class WaitlistController {
    private readonly campaign;
    constructor(campaign: CampaignService);
    getMyStatus(user: JwtPayload): Promise<{
        status: string;
        queuePosition: number | null;
    } | null>;
    activate(token: string): Promise<void>;
}
export declare class AdminCampaignController {
    private readonly campaign;
    constructor(campaign: CampaignService);
    list(): Promise<{
        name: string;
        id: string;
        startAt: Date;
        endAt: Date | null;
        capacity: number;
        grantedCount: number;
        maxWaitlistSize: number | null;
        status: import("@prisma/client").$Enums.CampaignStatus;
        waitlistMessage: string;
        waitlistFullMessage: string | null;
        waitlistDailyMessageLimit: number;
        displayCounterEnabled: boolean;
        displayInitialPct: number;
        displayFloor: number;
        displayTickSeconds: number;
        displayDecrementMin: number;
        displayDecrementMax: number;
        grantedSmsTemplate: string | null;
        reminderSteps: import("@prisma/client/runtime/client").JsonValue;
        createdAt: Date;
        createdByAdminId: string | null;
    }[]>;
    create(body: Record<string, unknown>): Promise<{
        name: string;
        id: string;
        startAt: Date;
        endAt: Date | null;
        capacity: number;
        grantedCount: number;
        maxWaitlistSize: number | null;
        status: import("@prisma/client").$Enums.CampaignStatus;
        waitlistMessage: string;
        waitlistFullMessage: string | null;
        waitlistDailyMessageLimit: number;
        displayCounterEnabled: boolean;
        displayInitialPct: number;
        displayFloor: number;
        displayTickSeconds: number;
        displayDecrementMin: number;
        displayDecrementMax: number;
        grantedSmsTemplate: string | null;
        reminderSteps: import("@prisma/client/runtime/client").JsonValue;
        createdAt: Date;
        createdByAdminId: string | null;
    }>;
    grantPhone(phone: string): Promise<{
        granted: boolean;
    }>;
    update(id: string, body: Record<string, unknown>): Promise<{
        name: string;
        id: string;
        startAt: Date;
        endAt: Date | null;
        capacity: number;
        grantedCount: number;
        maxWaitlistSize: number | null;
        status: import("@prisma/client").$Enums.CampaignStatus;
        waitlistMessage: string;
        waitlistFullMessage: string | null;
        waitlistDailyMessageLimit: number;
        displayCounterEnabled: boolean;
        displayInitialPct: number;
        displayFloor: number;
        displayTickSeconds: number;
        displayDecrementMin: number;
        displayDecrementMax: number;
        grantedSmsTemplate: string | null;
        reminderSteps: import("@prisma/client/runtime/client").JsonValue;
        createdAt: Date;
        createdByAdminId: string | null;
    }>;
    close(id: string): Promise<{
        name: string;
        id: string;
        startAt: Date;
        endAt: Date | null;
        capacity: number;
        grantedCount: number;
        maxWaitlistSize: number | null;
        status: import("@prisma/client").$Enums.CampaignStatus;
        waitlistMessage: string;
        waitlistFullMessage: string | null;
        waitlistDailyMessageLimit: number;
        displayCounterEnabled: boolean;
        displayInitialPct: number;
        displayFloor: number;
        displayTickSeconds: number;
        displayDecrementMin: number;
        displayDecrementMax: number;
        grantedSmsTemplate: string | null;
        reminderSteps: import("@prisma/client/runtime/client").JsonValue;
        createdAt: Date;
        createdByAdminId: string | null;
    }>;
    getWaitlist(id: string, status?: string): Promise<{
        id: string;
        status: import("@prisma/client").$Enums.WaitlistStatus;
        createdAt: Date;
        campaignId: string;
        phone: string;
        activationToken: string;
        grantedAt: Date | null;
        activatedAt: Date | null;
        lastReminderStepSent: number | null;
        lastReminderSentAt: Date | null;
        userId: string;
    }[]>;
    grant(id: string, mode: 'all' | number): Promise<{
        granted: number;
    }>;
}
