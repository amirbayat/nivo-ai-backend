import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
export type TokenizerFamily = 'o200k_base' | 'cl100k_base' | 'approximate';
export interface ModelInfo {
    inputPricePerM: number;
    outputPricePerM: number;
    tokenizerFamily: TokenizerFamily;
    avgCharsPerToken: number;
}
export declare class AiModelRegistryService {
    private readonly prisma;
    private readonly redis;
    constructor(prisma: PrismaService, redis: RedisService);
    getModelInfo(modelId: string): Promise<ModelInfo>;
    invalidate(modelId: string): Promise<void>;
}
