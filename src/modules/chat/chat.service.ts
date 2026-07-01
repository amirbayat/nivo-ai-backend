import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText, generateText } from 'ai'
import type { ModelMessage } from 'ai'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { TokenService } from '../usage/token.service'
import { PricingService } from '../usage/pricing.service'
import { fa } from '../../i18n/fa'
import type { Response } from 'express'
import { StreamMessageDto } from './dto/stream-message.dto'

const LEGACY_MODEL_MAP: Record<string, string> = {
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4-turbo': 'openai/gpt-4-turbo',
}

function resolveModelId(id: string): string {
  return LEGACY_MODEL_MAP[id] ?? id
}

// rough token estimate: ~3 chars per token for mixed Persian/English
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

@Injectable()
export class ChatService {
  private readonly provider

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokenService: TokenService,
    private readonly pricingService: PricingService,
    private readonly config: ConfigService,
  ) {
    this.provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey: this.config.get<string>('LIARA_API_KEY')!,
    })
  }

  async streamChat(conversationId: string, userId: string, dto: StreamMessageDto, res: Response) {
    // ── PREFLIGHT: all limit checks BEFORE committing to SSE stream ────────
    // These throw HttpExceptions → NestJS returns proper 4xx status codes
    // (no flushHeaders yet, so HTTP status is still settable)

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, model: true, systemPrompt: true, title: true, contextSummary: true },
    })
    if (!conversation) throw new NotFoundException(fa.conversations.notFound)
    if (conversation.userId !== userId) throw new ForbiddenException(fa.conversations.forbidden)

    const plan = await this.tokenService.getCachedPlan(userId)

    // ── manual limit set by admin ──────────────────────────────────────────
    const manualLimitRaw = await this.redis.get(`manual_limit:${userId}`)
    if (manualLimitRaw) {
      const ml = JSON.parse(manualLimitRaw) as { type: string; reason: string; expiresAt: number }
      const remaining = Math.ceil((ml.expiresAt - Date.now()) / 60_000)
      const msg = ml.reason
        ? `${ml.reason} (${remaining} دقیقه دیگر)`
        : `دسترسی شما توسط ادمین موقتاً محدود شده است (${remaining} دقیقه دیگر)`
      throw new HttpException({ message: msg }, 429)
    }

    // ── three-zone daily message limit ────────────────────────────────────
    const todayCount = await this.tokenService.getTodayRequestCount(userId)
    const N = plan.dailyMessageLimit      // normal zone ceiling (null = unlimited)
    const M = plan.throttledMessageCount ?? 0  // throttled zone size

    let messageStage: 'normal' | 'throttled' = 'normal'

    if (N !== null) {
      if (todayCount >= N + M) {
        // ── BLOCKED ────────────────────────────────────────────────────────
        throw new HttpException({
          message: fa.chat.dailyBlocked,
          planTier: plan.planTier,
          stage: 'blocked',
        }, 429)
      }
      if (todayCount >= N) {
        // ── THROTTLED ──────────────────────────────────────────────────────
        messageStage = 'throttled'
      }
    }

    // ── input token limit (adjusted for throttled zone) ───────────────────
    let effectiveInputLimit = this.tokenService.resolveInputLimit(plan)
    if (messageStage === 'throttled' && plan.throttledInputTokens) {
      effectiveInputLimit = plan.throttledInputTokens
    }
    const estimatedInput = estimateTokens(dto.content)
    if (estimatedInput > effectiveInputLimit) {
      throw new BadRequestException(fa.chat.inputTooLong(effectiveInputLimit))
    }

    // ── budget check + cascade model ───────────────────────────────────────
    const { cascadeModel } = await this.pricingService.assertBudget(userId, plan.priceMonthly, plan.planTier)

    let modelId = resolveModelId(dto.model ?? conversation.model)
    if (!(plan.allowedModels as string[]).includes(modelId)) {
      throw new ForbiddenException(fa.chat.modelNotAllowed)
    }

    const quota = await this.tokenService.checkQuota(userId)
    const throttledMax = this.tokenService.resolveOutputThrottle(plan.outputThrottleSteps, todayCount)
    let maxOut = Math.min(quota.remaining, throttledMax)
    // further restrict output if in throttled zone
    if (messageStage === 'throttled' && plan.throttledOutputTokens) {
      maxOut = Math.min(maxOut, plan.throttledOutputTokens)
    }

    // ── ALL CHECKS PASSED — start SSE stream ──────────────────────────────
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    // ── send stage info so frontend can update the banner ────────────────
    if (N !== null) {
      const remainingNormal    = Math.max(0, N - todayCount)
      const remainingThrottled = Math.max(0, N + M - todayCount)
      res.write(`data: ${JSON.stringify({
        info: 'stage',
        stage: messageStage,
        remainingNormal,
        remainingThrottled,
      })}\n\n`)
    }

    if (cascadeModel) {
      modelId = cascadeModel
      res.write(`data: ${JSON.stringify({ info: 'model_cascaded', model: cascadeModel })}\n\n`)
    }
    if (throttledMax < 4096) {
      res.write(`data: ${JSON.stringify({ info: 'output_throttled', maxOutputTokens: throttledMax })}\n\n`)
    }

    try {
      await this.prisma.message.create({
        data: { conversationId, role: 'USER', content: dto.content },
      })

      // ── build context: use summary + last 5 msgs if summary exists ─────────
      const systemParts: string[] = []
      if (conversation.systemPrompt) systemParts.push(conversation.systemPrompt)

      let recentMessages: { role: string; content: string }[]
      if (conversation.contextSummary) {
        systemParts.push(`خلاصه مکالمه تا کنون:\n${conversation.contextSummary}`)
        recentMessages = await this.prisma.message.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { role: true, content: true },
        })
        recentMessages = recentMessages.reverse()
      } else {
        recentMessages = await this.prisma.message.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
          take: 20,
          select: { role: true, content: true },
        })
      }

      const coreMessages: ModelMessage[] = recentMessages.map(m => ({
        role: m.role === 'USER' ? 'user' : m.role === 'ASSISTANT' ? 'assistant' : 'system',
        content: m.content,
      }))

      const result = streamText({
        model: this.provider(modelId),
        system: systemParts.join('\n\n') || undefined,
        messages: coreMessages,
        maxOutputTokens: maxOut,
      })

      let fullContent = ''
      const isFirstMessage = recentMessages.length === 1

      for await (const chunk of result.textStream) {
        fullContent += chunk
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`)
      }

      const usage = await result.usage
      const tokensUsed = usage.totalTokens ?? 0
      const costRial = await this.pricingService.calcCostRial(
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
        modelId,
      )

      await this.prisma.message.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: fullContent,
          tokensInput: usage.inputTokens ?? 0,
          tokensOutput: usage.outputTokens ?? 0,
          model: modelId,
        },
      })

      await Promise.all([
        this.tokenService.increment(userId, tokensUsed, quota.source),
        this.pricingService.trackCost(userId, costRial),
        this.prisma.conversation.update({
          where: { id: conversationId },
          data: { totalTokens: { increment: tokensUsed }, lastMessageAt: new Date() },
        }),
      ])

      if (!conversation.title && isFirstMessage) {
        await this.generateTitle(conversationId, dto.content, modelId)
      }

      res.write(`data: [DONE]\n\n`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : fa.chat.streamError
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`)
    } finally {
      res.end()
    }
  }

  private async generateTitle(conversationId: string, firstMessage: string, modelId: string): Promise<void> {
    try {
      const { text } = await generateText({
        model: this.provider(modelId),
        system: 'یک عنوان کوتاه (حداکثر ۵ کلمه) برای این مکالمه بنویس. فقط عنوان، بدون توضیح یا نقل‌قول.',
        messages: [{ role: 'user', content: firstMessage.slice(0, 300) }],
        maxOutputTokens: 40,
      })
      const title = text.trim().replace(/^["'«»\n]+|["'«»\n]+$/g, '')
      if (title) {
        await this.prisma.conversation.update({ where: { id: conversationId }, data: { title } })
      }
    } catch {
      // non-critical
    }
  }
}
