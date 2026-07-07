import { PrismaService } from '../../prisma/prisma.service';
export declare class SubscriptionsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getMySubscription(userId: string): Promise<{
        plan: {
            name: string;
            id: string;
            isActive: boolean;
            priceMonthly: number;
            dailyFreeTokens: number;
            monthlyTotalTokens: number;
            allowedModels: import("@prisma/client/runtime/client").JsonValue;
            features: import("@prisma/client/runtime/client").JsonValue;
            sortOrder: number;
            maxInputTokens: number;
            outputThrottleSteps: import("@prisma/client/runtime/client").JsonValue;
            dailyMessageLimit: number | null;
            throttledMessageCount: number | null;
            throttledInputTokens: number | null;
            throttledOutputTokens: number | null;
        };
    } & {
        id: string;
        status: import("@prisma/client").$Enums.SubscriptionStatus;
        createdAt: Date;
        userId: string;
        updatedAt: Date;
        planId: string;
        periodStart: Date;
        periodEnd: Date;
        cancelAtPeriodEnd: boolean;
    }>;
    cancel(userId: string): Promise<{
        message: "اشتراک در پایان دوره لغو خواهد شد";
    }>;
}
