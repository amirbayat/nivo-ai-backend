import { TicketPriority, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
export declare class TicketsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(userId: string, dto: CreateTicketDto): Promise<{
        message: "تیکت پشتیبانی شما با موفقیت ثبت شد";
        ticket: {
            id: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            createdAt: Date;
            userId: string;
            updatedAt: Date;
            subject: string;
            body: string;
            priority: import("@prisma/client").$Enums.TicketPriority;
            adminNote: string | null;
        };
    }>;
    findByUser(userId: string): Promise<{
        tickets: {
            id: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            createdAt: Date;
            updatedAt: Date;
            subject: string;
            priority: import("@prisma/client").$Enums.TicketPriority;
        }[];
    }>;
    findOneByUser(userId: string, ticketId: string): Promise<{
        ticket: {
            replies: {
                id: string;
                createdAt: Date;
                body: string;
                fromAdmin: boolean;
                ticketId: string;
            }[];
        } & {
            id: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            createdAt: Date;
            userId: string;
            updatedAt: Date;
            subject: string;
            body: string;
            priority: import("@prisma/client").$Enums.TicketPriority;
            adminNote: string | null;
        };
    }>;
    addUserReply(userId: string, ticketId: string, body: string): Promise<{
        reply: {
            id: string;
            createdAt: Date;
            body: string;
            fromAdmin: boolean;
            ticketId: string;
        };
    }>;
    findAll(status?: string): Promise<{
        tickets: ({
            user: {
                name: string | null;
                id: string;
                phone: string;
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
            status: import("@prisma/client").$Enums.TicketStatus;
            createdAt: Date;
            userId: string;
            updatedAt: Date;
            subject: string;
            body: string;
            priority: import("@prisma/client").$Enums.TicketPriority;
            adminNote: string | null;
        })[];
    }>;
    findOne(ticketId: string): Promise<{
        ticket: {
            user: {
                name: string | null;
                id: string;
                phone: string;
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
            status: import("@prisma/client").$Enums.TicketStatus;
            createdAt: Date;
            userId: string;
            updatedAt: Date;
            subject: string;
            body: string;
            priority: import("@prisma/client").$Enums.TicketPriority;
            adminNote: string | null;
        };
    }>;
    addAdminReply(ticketId: string, body: string, adminNote?: string): Promise<{
        reply: {
            id: string;
            createdAt: Date;
            body: string;
            fromAdmin: boolean;
            ticketId: string;
        };
    }>;
    updateStatus(ticketId: string, status?: TicketStatus, priority?: TicketPriority, adminNote?: string): Promise<{
        message: "تیکت به‌روز شد";
        ticket: {
            id: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            createdAt: Date;
            userId: string;
            updatedAt: Date;
            subject: string;
            body: string;
            priority: import("@prisma/client").$Enums.TicketPriority;
            adminNote: string | null;
        };
    }>;
}
