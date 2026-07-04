import { ConfigService } from '@nestjs/config';
import { ModelTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PricingService } from '../usage/pricing.service';
export interface RouteInput {
    userId: string;
    content: string;
    hasImages: boolean;
    allowedModels: string[];
    manualModel?: string;
    lastAssistantMessageLength?: number;
}
export interface RouteResult {
    modelId: string;
    tier: ModelTier;
    method: string;
    confidence: number;
    overriddenManualModel: string | null;
}
export declare class ModelRouterService {
    private readonly prisma;
    private readonly redis;
    private readonly config;
    private readonly pricingService;
    private readonly logger;
    private readonly provider;
    constructor(prisma: PrismaService, redis: RedisService, config: ConfigService, pricingService: PricingService);
    route(input: RouteInput): Promise<RouteResult>;
    log(input: {
        userId: string;
        conversationId: string;
    } & RouteResult): Promise<void>;
    invalidateConfigCache(): Promise<void>;
    private getConfig;
    private classify;
    private classifyHeuristic;
    private classifyWithLLM;
    private pickFromCandidates;
}
