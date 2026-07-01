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
        };
    }>;
    remove(id: string): Promise<{
        message: "پلن با موفقیت حذف شد";
    }>;
}
