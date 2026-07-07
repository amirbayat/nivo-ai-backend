import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
interface TopicInput {
    name: string;
    keywords: string[];
    color?: string | null;
    sortOrder?: number;
    isActive?: boolean;
}
export declare class TopicService {
    private readonly prisma;
    private readonly redis;
    constructor(prisma: PrismaService, redis: RedisService);
    classify(text: string): Promise<string | null>;
    list(): Promise<{
        name: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
        sortOrder: number;
        keywords: import("@prisma/client/runtime/client").JsonValue;
        color: string | null;
    }[]>;
    create(data: TopicInput): Promise<{
        name: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
        sortOrder: number;
        keywords: import("@prisma/client/runtime/client").JsonValue;
        color: string | null;
    }>;
    update(id: string, data: Partial<TopicInput>): Promise<{
        name: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
        sortOrder: number;
        keywords: import("@prisma/client/runtime/client").JsonValue;
        color: string | null;
    }>;
    remove(id: string): Promise<void>;
    private invalidateCache;
    private getActiveTopicRules;
}
export {};
