import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
export declare class ConversationsController {
    private readonly conversationsService;
    constructor(conversationsService: ConversationsService);
    create(user: JwtPayload, dto: CreateConversationDto): import("@prisma/client").Prisma.Prisma__ConversationClient<{
        id: string;
        createdAt: Date;
        userId: string;
        model: string;
        title: string | null;
        systemPrompt: string | null;
        totalTokens: number;
        isArchived: boolean;
        lastMessageAt: Date;
        contextSummary: string | null;
        summarizedAt: Date | null;
    }, never, import("@prisma/client/runtime/client").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    findAll(user: JwtPayload, query: ListConversationsDto): Promise<{
        items: {
            id: string;
            createdAt: Date;
            model: string;
            title: string | null;
            totalTokens: number;
            lastMessageAt: Date;
        }[];
        nextCursor: string | null;
    }>;
    findOne(user: JwtPayload, id: string): Promise<{
        messages: {
            id: string;
            role: import("@prisma/client").$Enums.MessageRole;
            createdAt: Date;
            model: string | null;
            content: string;
            tokensInput: number;
            tokensOutput: number;
            conversationId: string;
        }[];
    } & {
        id: string;
        createdAt: Date;
        userId: string;
        model: string;
        title: string | null;
        systemPrompt: string | null;
        totalTokens: number;
        isArchived: boolean;
        lastMessageAt: Date;
        contextSummary: string | null;
        summarizedAt: Date | null;
    }>;
    update(user: JwtPayload, id: string, dto: UpdateConversationDto): Promise<{
        message: "مکالمه به‌روز شد";
        conversation: {
            id: string;
            createdAt: Date;
            userId: string;
            model: string;
            title: string | null;
            systemPrompt: string | null;
            totalTokens: number;
            isArchived: boolean;
            lastMessageAt: Date;
            contextSummary: string | null;
            summarizedAt: Date | null;
        };
    }>;
    archive(user: JwtPayload, id: string): Promise<void>;
}
