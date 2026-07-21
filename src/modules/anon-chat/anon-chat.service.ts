import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText } from 'ai'
import type { ModelMessage } from 'ai'
import type { AnonymousConversation } from '@prisma/client'
import type { Response } from 'express'
import { isModelUnavailableError, unwrapAiSdkError } from '../../common/utils/ai-error.util'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import type { ReasoningEffortValue } from '../plans/reasoning-effort.constants'
import { TokenEstimatorService } from '../usage/token-estimator.service'
import { nextIranMidnightISO } from '../usage/token.service'
import { AnonChatConfigService } from './anon-chat-config.service'
import { AnonIdentityService, type AnonContext } from './anon-identity.service'
import { AnonFunnelEventService } from './anon-funnel-event.service'
import type { AnonStreamMessageDto } from './dto/anon-stream-message.dto'

// Iran Standard Time = UTC+3:30 — عمداً از token.service.ts وارد نشده (nه export شده، نه
// می‌خواهیم آن فایل production را برای یک ثابت لمس کنیم)؛ همان محاسبه، تکرار شده.
const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000
function iranDate(): string {
  return new Date(Date.now() + IRAN_OFFSET_MS).toISOString().slice(0, 10)
}
function anonDailyKey(identityId: string) {
  return `anon:req:${identityId}:${iranDate()}`
}

export type AnonChatStage = 'normal' | 'limited' | 'blocked'

@Injectable()
export class AnonChatService {
  private readonly logger = new Logger(AnonChatService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly tokenEstimator: TokenEstimatorService,
    private readonly configService: AnonChatConfigService,
    private readonly identityService: AnonIdentityService,
    private readonly funnelEvents: AnonFunnelEventService,
  ) {}

  private buildProvider(apiKey: string) {
    return createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey,
    })
  }

  // وضعیت فعلی identity نسبت به سقف‌ها — بدون throw، برای GET /anon-chat/status
  // (بنر فرانت باید همین وضعیت را پیش از تلاش کاربر برای ارسال نشان دهد)
  async getStatus(context: AnonContext) {
    const config = await this.configService.getConfig()
    const { identity } = context

    const pastFree = identity.lifetimeMessageCount >= config.freeMessageLimit
    let stage: AnonChatStage = 'normal'
    let todayCount = 0
    if (pastFree) {
      todayCount = Number(await this.redis.get(anonDailyKey(identity.id))) || 0
      stage = todayCount >= config.dailyMessageLimitAfterFree ? 'blocked' : 'limited'
    }

    const message =
      stage === 'blocked' ? config.blockedMessage : stage === 'limited' ? config.limitedZoneMessage : config.signupBannerMessage

    return {
      enabled: config.enabled,
      stage,
      message,
      hintTitle: config.hintTitle,
      hintSubtitle: config.hintSubtitle,
      remainingFree: Math.max(0, config.freeMessageLimit - identity.lifetimeMessageCount),
      remainingToday: pastFree ? Math.max(0, config.dailyMessageLimitAfterFree - todayCount) : null,
      resetAt: stage === 'blocked' ? nextIranMidnightISO() : null,
    }
  }

  async createConversation(context: AnonContext): Promise<AnonymousConversation> {
    const config = await this.configService.getConfig()
    if (!config.enabled) throw new ForbiddenException('چت آزمایشی موقتاً غیرفعال است')

    return this.prisma.anonymousConversation.create({
      data: { sessionId: context.session.id, model: config.defaultModel },
    })
  }

  async getConversation(context: AnonContext, conversationId: string) {
    const conversation = await this.prisma.anonymousConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!conversation) throw new NotFoundException('مکالمه یافت نشد')
    if (conversation.sessionId !== context.session.id) throw new ForbiddenException('دسترسی به این مکالمه مجاز نیست')
    return conversation
  }

  async streamChat(context: AnonContext, conversationId: string, dto: AnonStreamMessageDto, res: Response) {
    const config = await this.configService.getConfig()
    if (!config.enabled) throw new ForbiddenException('چت آزمایشی موقتاً غیرفعال است')

    const conversation = await this.prisma.anonymousConversation.findUnique({ where: { id: conversationId } })
    if (!conversation) throw new NotFoundException('مکالمه یافت نشد')
    if (conversation.sessionId !== context.session.id) throw new ForbiddenException('دسترسی به این مکالمه مجاز نیست')

    const { identity, session } = context
    const pastFree = identity.lifetimeMessageCount >= config.freeMessageLimit
    const dailyKey = anonDailyKey(identity.id)

    if (pastFree) {
      const todayCount = Number(await this.redis.get(dailyKey)) || 0
      if (todayCount >= config.dailyMessageLimitAfterFree) {
        this.funnelEvents.emit(session.id, 'HARD_BLOCKED').catch(() => {})
        throw new HttpException(
          { message: config.blockedMessage, stage: 'anon_blocked', resetAt: nextIranMidnightISO() },
          429,
        )
      }
      if (todayCount === 0) {
        this.funnelEvents.emit(session.id, 'ENTERED_LIMITED_ZONE').catch(() => {})
      }
    }

    const estimatedInput = await this.tokenEstimator.estimateTokens(dto.content, config.defaultModel)
    if (estimatedInput > config.maxInputTokens) {
      throw new BadRequestException(`پیام شما بیش از حد مجاز طولانی است (حداکثر ${config.maxInputTokens} توکن).`)
    }

    const existingMessageCount = await this.prisma.anonymousMessage.count({ where: { conversationId } })
    const isFirstMessage = existingMessageCount === 0

    await this.prisma.anonymousMessage.create({
      data: { conversationId, role: 'USER', content: dto.content },
    })
    if (isFirstMessage) {
      this.funnelEvents.emit(session.id, 'FIRST_MESSAGE_SENT').catch(() => {})
    }

    // تاریخچه‌ی این مکالمه محدود و کوتاه‌عمر است — بدون خلاصه‌سازی/سقف توکنی جدا (بر خلاف چت اصلی)
    const recentMessages = await this.prisma.anonymousMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 40,
      select: { role: true, content: true },
    })
    const coreMessages: ModelMessage[] = recentMessages.map((m) => ({
      role: m.role === 'USER' ? 'user' : m.role === 'ASSISTANT' ? 'assistant' : 'system',
      content: m.content,
    }))

    const apiKey = this.config.get<string>('LIARA_API_KEY')!

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    // اگر call به provider fail بشه (مثلاً 500 از Liara)، streamText بعد از exhaust شدن
    // retry داخلی، خطای واقعی رو توی این error-part callback می‌ده و خودش یک
    // NoOutputGeneratedError جدید و بدون cause می‌سازه و throw می‌کنه (چون هیچ step‌ای ثبت
    // نشده) — یعنی اگر این‌جا نگیریمش، در catch زیر گم می‌شه و دیگه غیرقابل unwrap است
    let capturedProviderError: unknown
    try {
      const result = streamText({
        model: this.buildProvider(apiKey)(config.defaultModel),
        messages: coreMessages,
        maxOutputTokens: config.maxOutputTokens,
        timeout: { chunkMs: 30_000 },
        // فرانت چت رایگان reasoning را نمایش نمی‌دهد؛ بدون این override مدل‌های reasoning
        // (خانواده‌ی gpt-5) با effort پیش‌فرض provider (معمولاً medium) بخشی از سقف خروجی و
        // زمان را صرف استدلال نامرئی می‌کنند — ادمین می‌تواند این را پایین بیاورد یا خالی
        // بگذارد تا از پیش‌فرض provider استفاده شود
        ...(config.reasoningEffort ? { reasoning: config.reasoningEffort as ReasoningEffortValue } : {}),
        onError: ({ error }) => {
          capturedProviderError = error
        },
      })

      let fullContent = ''
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          fullContent += part.text
          res.write(`data: ${JSON.stringify({ chunk: part.text })}\n\n`)
        }
      }

      const usage = await result.usage
      await this.prisma.anonymousMessage.create({
        data: {
          conversationId,
          role: 'ASSISTANT',
          content: fullContent,
          tokensInput: usage.inputTokens ?? 0,
          tokensOutput: usage.outputTokens ?? 0,
          model: config.defaultModel,
        },
      })

      await Promise.all([
        this.prisma.anonymousConversation.update({
          where: { id: conversationId },
          data: { totalTokens: { increment: usage.totalTokens ?? 0 }, lastMessageAt: new Date() },
        }),
        this.prisma.anonymousIdentity.update({
          where: { id: identity.id },
          data: { lifetimeMessageCount: { increment: 1 }, lastSeenAt: new Date() },
        }),
        pastFree ? this.incrementDailyCounter(dailyKey) : Promise.resolve(),
      ])

      res.write('data: [DONE]\n\n')
    } catch (err) {
      const rootError = capturedProviderError ?? err
      const isModelError = isModelUnavailableError(rootError)
      const actualError = unwrapAiSdkError(rootError)
      this.logger.error(
        `anon streamChat failed (model=${config.defaultModel}): ${actualError instanceof Error ? actualError.message : String(actualError)}`,
        actualError instanceof Error ? actualError.stack : undefined,
      )
      res.write(
        `data: ${JSON.stringify({
          error: isModelError ? 'مدل در دسترس نیست، لطفاً دوباره امتحان کنید' : 'خطایی در ارسال پیام رخ داد',
          code: isModelError ? 'model_unavailable' : 'stream_error',
        })}\n\n`,
      )
    } finally {
      res.end()
    }
  }

  // TTL کمی بیشتر از یک روز — اگر لحظه‌ی نیمه‌شب دقیق را از دست بدهیم هم کلید خودش پاک می‌شود
  private async incrementDailyCounter(key: string) {
    const count = await this.redis.incr(key)
    if (count === 1) await this.redis.expire(key, 26 * 60 * 60)
  }
}
