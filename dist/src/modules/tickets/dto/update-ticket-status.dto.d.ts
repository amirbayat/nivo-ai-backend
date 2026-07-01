import { TicketPriority, TicketStatus } from '@prisma/client';
export declare class UpdateTicketStatusDto {
    status?: TicketStatus;
    priority?: TicketPriority;
    adminNote?: string;
}
