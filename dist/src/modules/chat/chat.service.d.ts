import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { TokenService } from '../usage/token.service';
import { PricingService } from '../usage/pricing.service';
import { TokenEstimatorService } from '../usage/token-estimator.service';
import { ModelRouterService } from '../model-router/model-router.service';
import type { Response } from 'express';
import { StreamMessageDto } from './dto/stream-message.dto';
export declare class ChatService {
    private readonly prisma;
    private readonly redis;
    private readonly tokenService;
    private readonly pricingService;
    private readonly tokenEstimator;
    private readonly modelRouter;
    private readonly config;
    private readonly provider;
    constructor(prisma: PrismaService, redis: RedisService, tokenService: TokenService, pricingService: PricingService, tokenEstimator: TokenEstimatorService, modelRouter: ModelRouterService, config: ConfigService);
    streamChat(conversationId: string, userId: string, dto: StreamMessageDto, res: Response): Promise<void>;
    private generateTitle;
}
