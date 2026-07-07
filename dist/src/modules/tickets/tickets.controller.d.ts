import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateReplyDto } from './dto/create-reply.dto';
export declare class TicketsController {
    private readonly ticketsService;
    constructor(ticketsService: TicketsService);
    create(user: JwtPayload, dto: CreateTicketDto): Promise<{
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
    findAll(user: JwtPayload): Promise<{
        tickets: {
            id: string;
            status: import("@prisma/client").$Enums.TicketStatus;
            createdAt: Date;
            updatedAt: Date;
            subject: string;
            priority: import("@prisma/client").$Enums.TicketPriority;
        }[];
    }>;
    findOne(user: JwtPayload, id: string): Promise<{
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
    addReply(user: JwtPayload, id: string, dto: CreateReplyDto): Promise<{
        reply: {
            id: string;
            createdAt: Date;
            body: string;
            fromAdmin: boolean;
            ticketId: string;
        };
    }>;
}
