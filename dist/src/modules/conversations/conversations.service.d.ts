import { PrismaService } from '../../prisma/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ListConversationsDto } from './dto/list-conversations.dto';
export declare class ConversationsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(userId: string, dto: CreateConversationDto): import("@prisma/client").Prisma.Prisma__ConversationClient<{
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
    findAll(userId: string, query: ListConversationsDto): Promise<{
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
    findOne(id: string, userId: string): Promise<{
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
    update(id: string, userId: string, dto: UpdateConversationDto): Promise<{
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
    archive(id: string, userId: string): Promise<void>;
    private assertOwnership;
}
