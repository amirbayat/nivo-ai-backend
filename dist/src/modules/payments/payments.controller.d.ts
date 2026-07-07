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
        status: import("@prisma/client").$Enums.PaymentStatus;
        createdAt: Date;
        userId: string;
        updatedAt: Date;
        planId: string;
        metadata: import("@prisma/client/runtime/client").JsonValue | null;
        amount: number;
        authority: string | null;
        refId: string | null;
    })[]>;
    getHistory(user: JwtPayload): import("@prisma/client").Prisma.PrismaPromise<({
        plan: {
            name: string;
        };
    } & {
        id: string;
        status: import("@prisma/client").$Enums.PaymentStatus;
        createdAt: Date;
        userId: string;
        updatedAt: Date;
        planId: string;
        metadata: import("@prisma/client/runtime/client").JsonValue | null;
        amount: number;
        authority: string | null;
        refId: string | null;
    })[]>;
}
