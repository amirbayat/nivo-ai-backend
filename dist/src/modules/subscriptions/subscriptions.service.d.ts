import { PrismaService } from '../../prisma/prisma.service';
export declare class SubscriptionsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getMySubscription(userId: string): Promise<{
        plan: {
            id: string;
            name: string;
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
        createdAt: Date;
        updatedAt: Date;
        userId: string;
        planId: string;
        status: import("@prisma/client").$Enums.SubscriptionStatus;
        periodStart: Date;
        periodEnd: Date;
        cancelAtPeriodEnd: boolean;
    }>;
    cancel(userId: string): Promise<{
        message: "اشتراک در پایان دوره لغو خواهد شد";
    }>;
}
