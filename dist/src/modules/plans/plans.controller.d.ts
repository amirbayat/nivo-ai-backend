import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
export declare class PlansController {
    private readonly plansService;
    constructor(plansService: PlansService);
    findAll(): import("@prisma/client").Prisma.PrismaPromise<{
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
    }[]>;
    findAllAdmin(): import("@prisma/client").Prisma.PrismaPromise<{
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
    }[]>;
    findOne(id: string): Promise<{
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
    }>;
    create(dto: CreatePlanDto): Promise<{
        message: "پلن با موفقیت ایجاد شد";
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
    }>;
    update(id: string, dto: UpdatePlanDto): Promise<{
        message: "پلن با موفقیت به‌روز شد";
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
    }>;
    remove(id: string): Promise<{
        message: "پلن با موفقیت حذف شد";
    }>;
}
