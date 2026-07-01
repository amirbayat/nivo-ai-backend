import { AdminService } from './admin.service';
import { TicketsService } from '../tickets/tickets.service';
import { UpdateTicketStatusDto } from '../tickets/dto/update-ticket-status.dto';
export declare class AdminController {
    private readonly adminService;
    private readonly ticketsService;
    constructor(adminService: AdminService, ticketsService: TicketsService);
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
    getTickets(status?: string): Promise<{
        tickets: ({
            user: {
                id: string;
                phone: string;
                name: string | null;
            };
            replies: {
                id: string;
                createdAt: Date;
                body: string;
                fromAdmin: boolean;
                ticketId: string;
            }[];
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            subject: string;
            body: string;
            priority: import("@prisma/client").$Enums.TicketPriority;
            adminNote: string | null;
        })[];
    }>;
    getTicket(id: string): Promise<{
        ticket: {
            user: {
                id: string;
                phone: string;
                name: string | null;
            };
            replies: {
                id: string;
                createdAt: Date;
                body: string;
                fromAdmin: boolean;
                ticketId: string;
            }[];
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            subject: string;
            body: string;
            priority: import("@prisma/client").$Enums.TicketPriority;
            adminNote: string | null;
        };
    }>;
    addTicketReply(id: string, body: {
        body: string;
        adminNote?: string;
    }): Promise<{
        reply: {
            id: string;
            createdAt: Date;
            body: string;
            fromAdmin: boolean;
            ticketId: string;
        };
    }>;
    updateTicketStatus(id: string, dto: UpdateTicketStatusDto): Promise<{
        message: "تیکت به‌روز شد";
        ticket: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            subject: string;
            body: string;
            priority: import("@prisma/client").$Enums.TicketPriority;
            adminNote: string | null;
        };
    }>;
}
