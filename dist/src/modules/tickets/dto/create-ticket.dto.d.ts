import { TicketPriority } from '@prisma/client';
export declare class CreateTicketDto {
    subject: string;
    body: string;
    priority?: TicketPriority;
}
