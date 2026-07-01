import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
export declare class PlansService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(): Prisma.PrismaPromise<{
        id: string;
        name: string;
        isActive: boolean;
        priceMonthly: number;
        dailyFreeTokens: number;
        monthlyTotalTokens: number;
        allowedModels: Prisma.JsonValue;
        features: Prisma.JsonValue;
        sortOrder: number;
        maxInputTokens: number;
        outputThrottleSteps: Prisma.JsonValue;
    }[]>;
    findAllAdmin(): Prisma.PrismaPromise<{
        id: string;
        name: string;
        isActive: boolean;
        priceMonthly: number;
        dailyFreeTokens: number;
        monthlyTotalTokens: number;
        allowedModels: Prisma.JsonValue;
        features: Prisma.JsonValue;
        sortOrder: number;
        maxInputTokens: number;
        outputThrottleSteps: Prisma.JsonValue;
    }[]>;
    findOne(id: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        priceMonthly: number;
        dailyFreeTokens: number;
        monthlyTotalTokens: number;
        allowedModels: Prisma.JsonValue;
        features: Prisma.JsonValue;
        sortOrder: number;
        maxInputTokens: number;
        outputThrottleSteps: Prisma.JsonValue;
    }>;
    create(dto: CreatePlanDto): Prisma.Prisma__PlanClient<{
        id: string;
        name: string;
        isActive: boolean;
        priceMonthly: number;
        dailyFreeTokens: number;
        monthlyTotalTokens: number;
        allowedModels: Prisma.JsonValue;
        features: Prisma.JsonValue;
        sortOrder: number;
        maxInputTokens: number;
        outputThrottleSteps: Prisma.JsonValue;
    }, never, import("@prisma/client/runtime/client").DefaultArgs, Prisma.PrismaClientOptions>;
    update(id: string, dto: UpdatePlanDto): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        priceMonthly: number;
        dailyFreeTokens: number;
        monthlyTotalTokens: number;
        allowedModels: Prisma.JsonValue;
        features: Prisma.JsonValue;
        sortOrder: number;
        maxInputTokens: number;
        outputThrottleSteps: Prisma.JsonValue;
    }>;
    remove(id: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        priceMonthly: number;
        dailyFreeTokens: number;
        monthlyTotalTokens: number;
        allowedModels: Prisma.JsonValue;
        features: Prisma.JsonValue;
        sortOrder: number;
        maxInputTokens: number;
        outputThrottleSteps: Prisma.JsonValue;
    }>;
}
