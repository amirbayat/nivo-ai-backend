import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'

export type TokenizerFamily = 'o200k_base' | 'cl100k_base' | 'approximate'

export interface ModelInfo {
  inputPricePerM: number
  outputPricePerM: number
  tokenizerFamily: TokenizerFamily
  avgCharsPerToken: number
}

// used only if a model id has no AiModel row at all (e.g. never seeded) —
// keeps the system safe, not a substitute for real per-model DB config
const FALLBACK: ModelInfo = {
  inputPricePerM: 0.15,
  outputPricePerM: 0.6,
  tokenizerFamily: 'o200k_base',
  avgCharsPerToken: 4,
}

function cacheKey(modelId: string) {
  return `ai_model:${modelId}`
}

/**
 * Single source of truth for per-model pricing and tokenizer info — used by
 * both PricingService (cost calculation) and TokenEstimatorService (token
 * counting), so a model added once in /admin/models works correctly for
 * both without touching code. New non-OpenAI providers (Claude, Grok, ...)
 * just need a row with tokenizerFamily="approximate" and a calibrated
 * avgCharsPerToken — no tokenizer library needed for them.
 */
@Injectable()
export class AiModelRegistryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getModelInfo(modelId: string): Promise<ModelInfo> {
    const cached = await this.redis.get(cacheKey(modelId))
    if (cached) return JSON.parse(cached) as ModelInfo

    const model = await this.prisma.aiModel.findUnique({
      where: { name: modelId },
      select: {
        inputPricePerM: true,
        outputPricePerM: true,
        tokenizerFamily: true,
        avgCharsPerToken: true,
      },
    })

    const info: ModelInfo = model
      ? {
          inputPricePerM: model.inputPricePerM,
          outputPricePerM: model.outputPricePerM,
          tokenizerFamily: model.tokenizerFamily as TokenizerFamily,
          avgCharsPerToken: model.avgCharsPerToken,
        }
      : FALLBACK

    await this.redis.set(cacheKey(modelId), JSON.stringify(info), 'EX', 300)
    return info
  }

  async invalidate(modelId: string): Promise<void> {
    await this.redis.del(cacheKey(modelId))
  }
}
