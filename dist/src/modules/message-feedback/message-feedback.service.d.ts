import { ConfigService } from '@nestjs/config';
import { FeedbackVote, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitMessageFeedbackDto } from './dto/submit-feedback.dto';
export declare class MessageFeedbackService {
    private readonly prisma;
    private readonly config;
    private readonly provider;
    constructor(prisma: PrismaService, config: ConfigService);
    submit(userId: string, messageId: string, dto: SubmitMessageFeedbackDto): Promise<{
        message: "بازخورد شما ثبت شد";
        vote: import("@prisma/client").$Enums.FeedbackVote;
    }>;
    getAll(page?: number, limit?: number, model?: string, vote?: FeedbackVote): Promise<{
        items: ({
            message: {
                content: string;
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            userId: string;
            messageId: string;
            vote: import("@prisma/client").$Enums.FeedbackVote;
            comment: string | null;
            modelUsed: string;
            isChecked: boolean;
        })[];
        total: number;
        page: number;
        limit: number;
    }>;
    getSummary(): Prisma.Prisma__ModelFeedbackSummaryClient<{
        id: string;
        createdAt: Date;
        summary: string;
        topIssues: Prisma.JsonValue;
        totalProcessed: number;
        checkedUpTo: Date;
    } | null, null, import("@prisma/client/runtime/client").DefaultArgs, Prisma.PrismaClientOptions>;
    triggerSummary(): Promise<{
        message: "هنوز بازخورد جدیدی برای خلاصه‌سازی وجود ندارد";
        processed?: undefined;
    } | {
        message: "بازخورد شما ثبت شد";
        processed: number;
    }>;
    runSummary(): Promise<{
        message: "هنوز بازخورد جدیدی برای خلاصه‌سازی وجود ندارد";
        processed?: undefined;
    } | {
        message: "بازخورد شما ثبت شد";
        processed: number;
    }>;
}
