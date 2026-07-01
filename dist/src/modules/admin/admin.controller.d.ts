import { AdminService } from './admin.service';
export declare class AdminController {
    private readonly adminService;
    constructor(adminService: AdminService);
    getDashboard(): Promise<{
        totalUsers: number;
        activeUsers: number;
        totalRevenue: number;
        mrr: number;
        totalConversations: number;
        todayConversations: number;
    }>;
    getUsers(page?: string, limit?: string, search?: string): Promise<{
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
    updateUser(id: string, body: {
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
    getRevenue(): Promise<{
        month: string;
        revenue: number;
        count: number;
    }[]>;
    getPricingAlert(): Promise<{
        monthlyRevenueToman: number;
        monthlyAiCostRial: number;
        aiCostRatio: number;
        alertLevel: "warning" | "critical" | "safe";
        suggestion: string | null;
    }>;
    getCostChart(days?: string): Promise<{
        date: string;
        aiCostRial: number;
        revenueToman: number;
    }[]>;
    setLimit(id: string, body: {
        type: 'daily' | '1h' | '3h' | '6h';
        reason?: string;
    }): Promise<{
        success: boolean;
        expiresAt: string;
    }>;
    removeLimit(id: string): Promise<{
        success: boolean;
    }>;
    getLimit(id: string): Promise<{
        type: "daily" | "1h" | "3h" | "6h";
        reason: string;
        expiresAt: number;
    } | null>;
    changePlan(id: string, body: {
        planId: string;
    }): Promise<{
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
}
