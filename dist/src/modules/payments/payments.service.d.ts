import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../usage/token.service';
import { ZarinpalService } from './zarinpal.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
export declare class PaymentsService {
    private readonly prisma;
    private readonly zarinpal;
    private readonly tokenService;
    private readonly config;
    constructor(prisma: PrismaService, zarinpal: ZarinpalService, tokenService: TokenService, config: ConfigService);
    initiate(userId: string, dto: InitiatePaymentDto): Promise<{
        paymentUrl: string;
        authority: string;
    }>;
    verify(authority: string, status: string): Promise<{
        redirect: string;
    }>;
    findAll(userId: string): import("@prisma/client").Prisma.PrismaPromise<({
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
    getHistory(userId: string): import("@prisma/client").Prisma.PrismaPromise<({
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
