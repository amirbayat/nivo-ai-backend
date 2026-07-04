import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateObject } from 'ai'
import { z } from 'zod'
import { ModelTier, type AiModel } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { PricingService } from '../usage/pricing.service'

const CONFIG_CACHE_KEY = 'model_routing_config:cache'
const CONFIG_CACHE_TTL = 60 // ثانیه
const SINGLETON_ID = 'singleton'

const DEFAULT_SIMPLE_KEYWORDS = [
  'سلام',
  'خداحافظ',
  'ممنون',
  'مرسی',
  'باشه',
  'یعنی چی',
  'ترجمه کن',
  'کوتاه بگو',
]
const DEFAULT_COMPLEX_KEYWORDS = [
  'دیباگ',
  'معماری',
  'الگوریتم',
  'ثابت کن',
  'قدم به قدم',
  'تحلیل کن',
  'مقایسه کن',
  'بهینه‌سازی',
  'قرارداد',
  'کد کامل بنویس',
]

interface RoutingConfigShape {
  enabled: boolean
  simpleKeywords: string[]
  complexKeywords: string[]
  complexLenThreshold: number
  llmFallbackEnabled: boolean
  llmFallbackModel: string
}

export interface RouteInput {
  userId: string
  content: string
  hasImages: boolean
  allowedModels: string[]
  manualModel?: string
  lastAssistantMessageLength?: number
}

export interface RouteResult {
  modelId: string
  tier: ModelTier
  method: string
  confidence: number
  overriddenManualModel: string | null
}

const TIER_RANK: Record<ModelTier, number> = {
  SIMPLE: 0,
  MEDIUM: 1,
  COMPLEX: 2,
}

@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name)
  private readonly provider

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly pricingService: PricingService,
  ) {
    this.provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey: this.config.get<string>('LIARA_API_KEY')!,
    })
  }

  async route(input: RouteInput): Promise<RouteResult> {
    const config = await this.getConfig()

    if (!config.enabled) {
      const modelId = input.manualModel ?? input.allowedModels[0]
      return {
        modelId,
        tier: ModelTier.MEDIUM,
        method: 'disabled',
        confidence: 1,
        overriddenManualModel: null,
      }
    }

    const { tier, method, confidence } = await this.classify(input, config)

    const candidates = await this.prisma.aiModel.findMany({
      where: {
        name: { in: input.allowedModels },
        isActive: true,
        ...(input.hasImages ? { supportsVision: true } : {}),
      },
      orderBy: { sortOrder: 'asc' },
    })

    // هیچ مدل مجازی شرایط (مثلاً vision) رو نداره — فال‌بک امن به انتخاب فعلی
    if (!candidates.length) {
      return {
        modelId: input.manualModel ?? input.allowedModels[0],
        tier,
        method,
        confidence,
        overriddenManualModel: null,
      }
    }

    // قانون اصلی: پیام ساده همیشه ارزون‌ترین مدل مجاز رو می‌گیره، حتی اگه کاربر دستی مدل قوی‌تری انتخاب کرده باشه
    if (tier === ModelTier.SIMPLE) {
      const modelId = this.pickFromCandidates(candidates, ModelTier.SIMPLE)
      return {
        modelId,
        tier,
        method,
        confidence,
        overriddenManualModel:
          input.manualModel && input.manualModel !== modelId
            ? input.manualModel
            : null,
      }
    }

    // MEDIUM/COMPLEX: انتخاب دستی کاربر (اگه مجاز و سازگار باشه) محترم شمرده می‌شه
    if (
      input.manualModel &&
      candidates.some((c) => c.name === input.manualModel)
    ) {
      return {
        modelId: input.manualModel,
        tier,
        method: 'manual',
        confidence: 1,
        overriddenManualModel: null,
      }
    }

    const modelId = this.pickFromCandidates(candidates, tier)
    return { modelId, tier, method, confidence, overriddenManualModel: null }
  }

  /** لاگ async — هیچ‌وقت نباید فلوی چت رو کند یا مختل کنه */
  async log(
    input: { userId: string; conversationId: string } & RouteResult,
  ): Promise<void> {
    try {
      await this.prisma.modelRoutingLog.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          chosenModel: input.modelId,
          tier: input.tier,
          method: input.method,
          confidence: input.confidence,
          overrodeManual: input.overriddenManualModel,
        },
      })
    } catch (err) {
      this.logger.warn(
        `failed to write ModelRoutingLog: ${(err as Error).message}`,
      )
    }
  }

  async invalidateConfigCache(): Promise<void> {
    await this.redis.del(CONFIG_CACHE_KEY)
  }

  private async getConfig(): Promise<RoutingConfigShape> {
    const cached = await this.redis.get(CONFIG_CACHE_KEY)
    if (cached) return JSON.parse(cached) as RoutingConfigShape

    let row = await this.prisma.modelRoutingConfig.findFirst()
    if (!row) {
      row = await this.prisma.modelRoutingConfig.create({
        data: {
          id: SINGLETON_ID,
          simpleKeywords: DEFAULT_SIMPLE_KEYWORDS,
          complexKeywords: DEFAULT_COMPLEX_KEYWORDS,
        },
      })
    }

    const shape: RoutingConfigShape = {
      enabled: row.enabled,
      simpleKeywords: row.simpleKeywords as string[],
      complexKeywords: row.complexKeywords as string[],
      complexLenThreshold: row.complexLenThreshold,
      llmFallbackEnabled: row.llmFallbackEnabled,
      llmFallbackModel: row.llmFallbackModel,
    }

    await this.redis.set(
      CONFIG_CACHE_KEY,
      JSON.stringify(shape),
      'EX',
      CONFIG_CACHE_TTL,
    )
    return shape
  }

  private async classify(
    input: RouteInput,
    config: RoutingConfigShape,
  ): Promise<{ tier: ModelTier; method: string; confidence: number }> {
    const heuristic = this.classifyHeuristic(
      input.content,
      config,
      input.lastAssistantMessageLength,
    )
    if (heuristic.tier !== 'ambiguous') {
      return {
        tier: heuristic.tier,
        method: heuristic.method,
        confidence: heuristic.confidence,
      }
    }

    if (config.llmFallbackEnabled) {
      const llm = await this.classifyWithLLM(
        input.content,
        config.llmFallbackModel,
        input.userId,
      )
      if (llm)
        return { tier: llm.tier, method: 'llm', confidence: llm.confidence }
    }

    // پیش‌فرض امن وقتی هم heuristic هم LLM (یا اگه غیرفعال بود) نتونستن قطعی تشخیص بدن
    return { tier: ModelTier.MEDIUM, method: 'heuristic', confidence: 0.5 }
  }

  private classifyHeuristic(
    content: string,
    config: RoutingConfigShape,
    lastAssistantMessageLength?: number,
  ): { tier: ModelTier | 'ambiguous'; method: string; confidence: number } {
    // ثبات درون مکالمه: پیام کوتاه بلافاصله بعد از یک پاسخ بلند/پیچیده رو نباید degrade کنه
    if (
      lastAssistantMessageLength &&
      lastAssistantMessageLength > 800 &&
      content.length < 20
    ) {
      return { tier: ModelTier.COMPLEX, method: 'sticky', confidence: 0.9 }
    }

    const hasCodeBlock = content.includes('```')
    const complexHits = countKeywordHits(content, config.complexKeywords)
    const simpleHits = countKeywordHits(content, config.simpleKeywords)

    if (content.length < 40 && complexHits === 0 && !hasCodeBlock) {
      return { tier: ModelTier.SIMPLE, method: 'heuristic', confidence: 0.85 }
    }

    if (
      hasCodeBlock ||
      complexHits >= 2 ||
      content.length > config.complexLenThreshold
    ) {
      return { tier: ModelTier.COMPLEX, method: 'heuristic', confidence: 0.8 }
    }

    if (simpleHits > 0 && complexHits === 0 && content.length < 150) {
      return { tier: ModelTier.SIMPLE, method: 'heuristic', confidence: 0.7 }
    }

    return { tier: 'ambiguous', method: 'heuristic', confidence: 0 }
  }

  private async classifyWithLLM(
    content: string,
    modelId: string,
    userId: string,
  ): Promise<{ tier: ModelTier; confidence: number } | null> {
    try {
      const { object, usage } = await generateObject({
        model: this.provider(modelId),
        schema: z.object({
          tier: z.enum(['SIMPLE', 'MEDIUM', 'COMPLEX']),
          reason: z.string().max(80),
        }),
        system: `این پیام کاربر را از نظر سختی طبقه‌بندی کن.
SIMPLE: احوال‌پرسی، سوال کوتاه واقعیت‌محور، ترجمه/بازنویسی کوتاه.
MEDIUM: نوشتن متن چندبندی، توضیح مفهوم، کد کوتاه.
COMPLEX: استدلال چندمرحله‌ای، کد/معماری پیچیده، تحلیل سند بلند، درخواست صریح تفکر عمیق.`,
        messages: [{ role: 'user', content: content.slice(0, 2000) }],
      })

      if (usage) {
        const costRial = await this.pricingService.calcCostRial(
          usage.inputTokens ?? 0,
          usage.outputTokens ?? 0,
          modelId,
        )
        this.pricingService.trackCost(userId, costRial).catch(() => {})
      }

      return { tier: ModelTier[object.tier], confidence: 0.75 }
    } catch (err) {
      this.logger.warn(
        `classifier LLM call failed, falling back to MEDIUM: ${(err as Error).message}`,
      )
      return null
    }
  }

  private pickFromCandidates(
    candidates: AiModel[],
    desiredTier: ModelTier,
  ): string {
    const exact = candidates.filter((c) => c.tier === desiredTier)
    if (exact.length) return exact[0].name

    const sorted = [...candidates].sort((a, b) => {
      const da = Math.abs(TIER_RANK[a.tier] - TIER_RANK[desiredTier])
      const db = Math.abs(TIER_RANK[b.tier] - TIER_RANK[desiredTier])
      return da - db || a.sortOrder - b.sortOrder
    })
    return sorted[0].name
  }
}

function countKeywordHits(text: string, keywords: string[]): number {
  return keywords.reduce((n, k) => (text.includes(k) ? n + 1 : n), 0)
}
