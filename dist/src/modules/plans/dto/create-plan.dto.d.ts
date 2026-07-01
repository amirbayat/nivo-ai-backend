export declare class CreatePlanDto {
    name: string;
    priceMonthly: number;
    dailyFreeTokens: number;
    monthlyTotalTokens: number;
    allowedModels: string[];
    features?: Record<string, unknown>;
    isActive: boolean;
    sortOrder: number;
    dailyMessageLimit?: number | null;
    maxInputTokens?: number;
    outputThrottleSteps?: {
        afterMessages: number;
        maxOutputTokens: number;
    }[];
    throttledMessageCount?: number | null;
    throttledInputTokens?: number | null;
    throttledOutputTokens?: number | null;
}
