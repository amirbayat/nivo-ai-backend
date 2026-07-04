import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { MessageFeedbackService } from './message-feedback.service';
import { SubmitMessageFeedbackDto } from './dto/submit-feedback.dto';
export declare class MessageFeedbackController {
    private readonly messageFeedbackService;
    constructor(messageFeedbackService: MessageFeedbackService);
    submit(user: JwtPayload, id: string, dto: SubmitMessageFeedbackDto): Promise<{
        message: "بازخورد شما ثبت شد";
        vote: import("@prisma/client").$Enums.FeedbackVote;
    }>;
    getAll(page?: string, limit?: string, model?: string, vote?: string): Promise<{
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
    getSummary(): import("@prisma/client").Prisma.Prisma__ModelFeedbackSummaryClient<{
        id: string;
        createdAt: Date;
        summary: string;
        topIssues: import("@prisma/client/runtime/client").JsonValue;
        totalProcessed: number;
        checkedUpTo: Date;
    } | null, null, import("@prisma/client/runtime/client").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    triggerSummary(): Promise<{
        message: "هنوز بازخورد جدیدی برای خلاصه‌سازی وجود ندارد";
        processed?: undefined;
    } | {
        message: "بازخورد شما ثبت شد";
        processed: number;
    }>;
}
