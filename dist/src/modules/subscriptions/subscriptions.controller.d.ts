import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
export declare class SubscriptionsController {
    private readonly subscriptionsService;
    constructor(subscriptionsService: SubscriptionsService);
    getMySubscription(user: JwtPayload): Promise<{
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
    cancel(user: JwtPayload): Promise<{
        message: "اشتراک در پایان دوره لغو خواهد شد";
    }>;
}
