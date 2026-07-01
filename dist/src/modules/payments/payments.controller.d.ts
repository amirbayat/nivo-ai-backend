import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
export declare class PaymentsController {
    private readonly paymentsService;
    constructor(paymentsService: PaymentsService);
    initiate(user: JwtPayload, dto: InitiatePaymentDto): Promise<{
        paymentUrl: string;
        authority: string;
    }>;
    callback(authority: string, status: string): Promise<{
        url: string;
    }>;
    findAll(user: JwtPayload): import("@prisma/client").Prisma.PrismaPromise<({
        plan: {
            name: string;
        };
    } & {
        id: string;
        userId: string;
        planId: string;
        status: import("@prisma/client").$Enums.PaymentStatus;
        createdAt: Date;
        updatedAt: Date;
        metadata: import("@prisma/client/runtime/client").JsonValue | null;
        authority: string | null;
        amount: number;
        refId: string | null;
    })[]>;
    getHistory(user: JwtPayload): import("@prisma/client").Prisma.PrismaPromise<({
        plan: {
            name: string;
        };
    } & {
        id: string;
        userId: string;
        planId: string;
        status: import("@prisma/client").$Enums.PaymentStatus;
        createdAt: Date;
        updatedAt: Date;
        metadata: import("@prisma/client/runtime/client").JsonValue | null;
        authority: string | null;
        amount: number;
        refId: string | null;
    })[]>;
}
