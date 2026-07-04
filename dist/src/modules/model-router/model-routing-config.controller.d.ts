import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ModelRouterService } from './model-router.service';
import { UpdateRoutingConfigDto } from './dto/update-routing-config.dto';
export declare class ModelRoutingConfigController {
    private readonly prisma;
    private readonly modelRouter;
    constructor(prisma: PrismaService, modelRouter: ModelRouterService);
    get(): Promise<{
        id: string;
        updatedAt: Date;
        enabled: boolean;
        simpleKeywords: Prisma.JsonValue;
        complexKeywords: Prisma.JsonValue;
        complexLenThreshold: number;
        llmFallbackEnabled: boolean;
        llmFallbackModel: string;
    }>;
    update(dto: UpdateRoutingConfigDto): Promise<{
        id: string;
        updatedAt: Date;
        enabled: boolean;
        simpleKeywords: Prisma.JsonValue;
        complexKeywords: Prisma.JsonValue;
        complexLenThreshold: number;
        llmFallbackEnabled: boolean;
        llmFallbackModel: string;
    }>;
}
