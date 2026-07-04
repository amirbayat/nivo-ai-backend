import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
type LimitType = 'daily' | '1h' | '3h' | '6h';
export declare class AdminService {
    private readonly prisma;
    private readonly redis;
    constructor(prisma: PrismaService, redis: RedisService);
    getDashboard(): Promise<{
        totalUsers: number;
        activeUsers: number;
        totalRevenue: number;
        mrr: number;
        totalConversations: number;
        todayConversations: number;
    }>;
    getUsers(page: number, limit: number, search?: string): Promise<{
        users: {
            chargedThisMonth: number;
            aiCostThisMonth: number;
            expectedByNow: number;
            category: "heavy" | "moderate" | "light" | "inactive";
            subscription: {
                plan: {
                    name: string;
                    priceMonthly: number;
                };
                status: import("@prisma/client").$Enums.SubscriptionStatus;
                periodStart: Date;
                periodEnd: Date;
            } | null;
            id: string;
            phone: string;
            name: string | null;
            role: import("@prisma/client").$Enums.Role;
            isActive: boolean;
            createdAt: Date;
        }[];
        total: number;
        page: number;
        limit: number;
    }>;
    updateUser(userId: string, data: {
        isActive?: boolean;
        role?: 'USER' | 'ADMIN';
    }): Promise<{
        message: "کاربر به‌روز شد";
        user: {
            id: string;
            phone: string;
            name: string | null;
            role: import("@prisma/client").$Enums.Role;
            isActive: boolean;
        };
    }>;
    getTokenStats(): Promise<{
        today: {
            totalFree: number;
            totalPaid: number;
            requests: number;
        };
        thisMonth: {
            totalFree: number;
            totalPaid: number;
        };
    }>;
    getCostChart(days?: number): Promise<{
        date: string;
        aiCostRial: number;
        revenueToman: number;
    }[]>;
    getPricingAlert(): Promise<{
        monthlyRevenueToman: number;
        monthlyAiCostRial: number;
        aiCostRatio: number;
        alertLevel: "warning" | "critical" | "safe";
        suggestion: string | null;
    }>;
    setManualLimit(userId: string, type: LimitType, reason?: string): Promise<{
        success: boolean;
        expiresAt: string;
    }>;
    removeManualLimit(userId: string): Promise<{
        success: boolean;
    }>;
    getManualLimit(userId: string): Promise<{
        type: LimitType;
        reason: string;
        expiresAt: number;
    } | null>;
    changeUserPlan(userId: string, planId: string): Promise<{
        success: boolean;
        subscription: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            planId: string;
            status: import("@prisma/client").$Enums.SubscriptionStatus;
            periodStart: Date;
            periodEnd: Date;
            cancelAtPeriodEnd: boolean;
        };
    }>;
    getRevenueStats(): Promise<{
        month: string;
        revenue: number;
        count: number;
    }[]>;
    getModels(): import("@prisma/client").Prisma.PrismaPromise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        sortOrder: number;
        tier: import("@prisma/client").$Enums.ModelTier;
        displayName: string;
        provider: string;
        inputPricePerM: number;
        outputPricePerM: number;
        supportsVision: boolean;
    }[]>;
    createModel(dto: {
        name: string;
        displayName: string;
        provider: string;
        inputPricePerM: number;
        outputPricePerM: number;
        supportsVision: boolean;
        isActive: boolean;
        sortOrder: number;
        tier?: 'SIMPLE' | 'MEDIUM' | 'COMPLEX';
    }): import("@prisma/client").Prisma.Prisma__AiModelClient<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        sortOrder: number;
        tier: import("@prisma/client").$Enums.ModelTier;
        displayName: string;
        provider: string;
        inputPricePerM: number;
        outputPricePerM: number;
        supportsVision: boolean;
    }, never, import("@prisma/client/runtime/client").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    updateModel(id: string, dto: Partial<{
        name: string;
        displayName: string;
        provider: string;
        inputPricePerM: number;
        outputPricePerM: number;
        supportsVision: boolean;
        isActive: boolean;
        sortOrder: number;
        tier: 'SIMPLE' | 'MEDIUM' | 'COMPLEX';
    }>): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        createdAt: Date;
        sortOrder: number;
        tier: import("@prisma/client").$Enums.ModelTier;
        displayName: string;
        provider: string;
        inputPricePerM: number;
        outputPricePerM: number;
        supportsVision: boolean;
    }>;
    deleteModel(id: string): Promise<{
        message: string;
    }>;
}
export {};
