import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as crypto from 'crypto'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { streamText, APICallError, RetryError } from 'ai'
import type { ModelMessage, UserModelMessage } from 'ai'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { TokenService, rollingWindowKey } from '../usage/token.service'
import { PricingService } from '../usage/pricing.service'
import { TokenEstimatorService } from '../usage/token-estimator.service'
import { ModelRouterService } from '../model-router/model-router.service'
import { UsageAnalyticsService } from '../usage-analytics/usage-analytics.service'
import { TopicService } from '../usage-analytics/topic.service'
import { CampaignService } from '../campaign/campaign.service'
import { ChatConfigService } from '../chat-config/chat-config.service'
import { fa } from '../../i18n/fa'
import type { Response } from 'express'
import { StreamMessageDto } from './dto/stream-message.dto'

const OPTIMAL_MODE = 'optimal'

// the input-length gate below runs before model routing (the router itself
// uses input length as a heuristic signal), so the exact model isn't known
// yet — o200k_base is the shared encoding for the whole gpt-4o family
// (including the free plan's only model) and a close-enough reference for
// this pre-routing safety check; real billing always uses the SDK's actual
// usage.inputTokens/outputTokens for the model that ends up running.
const PRE_ROUTING_REFERENCE_MODEL = 'openai/gpt-4o-mini'

const LEGACY_MODEL_MAP: Record<string, string> = {
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4-turbo': 'openai/gpt-4-turbo',
}

function resolveModelId(id: string): string {
  return LEGACY_MODEL_MAP[id] ?? id
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)
  private readonly provider

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokenService: TokenService,
    private readonly pricingService: PricingService,
    private readonly tokenEstimator: TokenEstimatorService,
    private readonly modelRouter: ModelRouterService,
    private readonly usageAnalytics: UsageAnalyticsService,
    private readonly topicService: TopicService,
    private readonly campaignService: CampaignService,
    private readonly chatConfigService: ChatConfigService,
    private readonly config: ConfigService,
  ) {
    this.provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey: this.config.get<string>('LIARA_API_KEY')!,
    })
  }

  // برای درخواست‌های کوچک/یک‌باره‌ی داخلی (عنوان‌سازی، خلاصه‌سازی) به‌جای generateText.
  // دلیل: در لاگ پروداکشن تأیید شد که Liara برای بعضی مدل‌ها روی مسیر non-streaming
  // (generateText) خطای ۵۰۰ عمومی می‌دهد، در حالی که همان مدل‌ها روی streamText (که چت اصلی
  // هم از آن استفاده می‌کند) درست کار می‌کنند — پس همین‌جا هم به‌جای تک‌درخواست، استریم می‌کنیم
  // و متن کامل را جمع می‌زنیم؛ رفتار برای caller یکسان است، فقط مسیر گیت‌وی فرق می‌کند.
  private async generateTextViaStream(params: {
    modelId: string
    system: string
    userContent: string
    maxOutputTokens: number
  }): Promise<string> {
    const result = streamText({
      model: this.provider(params.modelId),
      system: params.system,
      messages: [{ role: 'user', content: params.userContent }],
      maxOutputTokens: params.maxOutputTokens,
      // مدل‌های reasoning پیش‌فرض روی reasoning_effort="medium" هستند و می‌توانند کل سقف
      // خروجی را صرف توکن‌های استدلال نامرئی کنند و متن واقعی چیزی نداشته باشد (دقیقاً همین
      // اتفاق در لاگ پروداکشن با maxOutputTokens=300 هم افتاد) — برای این تسک‌های بی‌اهمیت
      // (عنوان/خلاصه‌ی کوتاه) استدلال عمیق لازم نیست، پس effort را به حداقل می‌بریم
      reasoning: 'minimal',
    })
    let text = ''
    for await (const chunk of result.textStream) {
      text += chunk
    }
    return text
  }

  async streamChat(
    conversationId: string,
    userId: string,
    dto: StreamMessageDto,
    res: Response,
  ) {
    // ── PREFLIGHT: all limit checks BEFORE committing to SSE stream ────────
    // These throw HttpExceptions → NestJS returns proper 4xx status codes
    // (no flushHeaders yet, so HTTP status is still settable)

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        userId: true,
        model: true,
        systemPrompt: true,
        title: true,
        contextSummary: true,
        summarizedUntilCreatedAt: true,
      },
    })
    if (!conversation) throw new NotFoundException(fa.conversations.notFound)
    if (conversation.userId !== userId)
      throw new ForbiddenException(fa.conversations.forbidden)

    const plan = await this.tokenService.getCachedPlan(userId)

    // ── دوره‌ی آزمایشی کاربر تازه (docs/PRD-growth-traction-features.md بخش ۳) — منطق کامل
    // (شامل توضیح fallback) در TokenService.getEffectiveLimits؛ همان تابع را usage.controller
    // (بنر محدودیت) هم صدا می‌زند تا این دو جا از هم عقب نیفتند.
    const { inTrial, lifetimeMessageCount, effectiveN, effectiveM, effectiveRollingLimit, effectiveRollingHours } =
      await this.tokenService.getEffectiveLimits(userId, plan)

    // ── manual limit set by admin ──────────────────────────────────────────
    const manualLimitRaw = await this.redis.get(`manual_limit:${userId}`)
    if (manualLimitRaw) {
      const ml = JSON.parse(manualLimitRaw) as {
        type: string
        reason: string
        expiresAt: number
      }
      const remaining = Math.ceil((ml.expiresAt - Date.now()) / 60_000)
      const msg = ml.reason
        ? `${ml.reason} (${remaining} دقیقه دیگر)`
        : `دسترسی شما توسط ادمین موقتاً محدود شده است (${remaining} دقیقه دیگر)`
      throw new HttpException({ message: msg }, 429)
    }

    // ── three-zone daily message limit ────────────────────────────────────
    const todayCount = await this.tokenService.getTodayRequestCount(userId)

    // ── سقف موقت لیست انتظار کمپین سافت‌لانچ — بخش ۱۸.۴ ────────────────────
    const waitlistLimit = await this.campaignService.getWaitingDailyLimit(userId)
    if (waitlistLimit !== null && todayCount >= waitlistLimit) {
      this.usageAnalytics.logLimitHit(userId, 'DAILY_MESSAGE_BLOCKED').catch(() => {})
      throw new HttpException({ message: fa.waitlist.limitReached, waitlisted: true }, 429)
    }

    const N = effectiveN // normal zone ceiling (null = unlimited)
    const M = effectiveM ?? 0 // throttled zone size

    let messageStage: 'normal' | 'throttled' = 'normal'

    if (N !== null) {
      if (todayCount >= N + M) {
        // ── BLOCKED ────────────────────────────────────────────────────────
        this.usageAnalytics.logLimitHit(userId, 'DAILY_MESSAGE_BLOCKED').catch(() => {})
        throw new HttpException(
          {
            message: fa.chat.dailyBlocked,
            planTier: plan.planTier,
            stage: 'blocked',
          },
          429,
        )
      }
      if (todayCount >= N) {
        // ── THROTTLED ──────────────────────────────────────────────────────
        messageStage = 'throttled'
      }
    }

    // ── پنجره‌ی لغزان (rolling window) — بخش ۸ PRD-global-budget-gateway.md ──
    // مکمل سقف روزانه‌ی بالا، نه جایگزین آن — هر دو باید هم‌زمان رعایت شوند.
    // null یعنی این پلن اصلاً محدودیت پنجره‌ای ندارد.
    const rollingWindow = await this.tokenService.getRollingWindowStatus(userId, {
      rollingWindowLimit: effectiveRollingLimit,
      rollingWindowHours: effectiveRollingHours ?? plan.rollingWindowHours,
    })
    if (rollingWindow.blocked) {
      this.usageAnalytics.logLimitHit(userId, 'ROLLING_WINDOW_BLOCKED').catch(() => {})
      throw new HttpException(
        {
          message: fa.chat.rollingWindowBlocked(effectiveRollingHours ?? plan.rollingWindowHours),
          stage: 'rolling_window_blocked',
          planTier: plan.planTier,
          resetAt: rollingWindow.resetAt,
        },
        429,
      )
    }

    // ── input token limit (adjusted for throttled zone) ───────────────────
    let effectiveInputLimit = this.tokenService.resolveInputLimit(plan)
    if (messageStage === 'throttled' && plan.throttledInputTokens) {
      effectiveInputLimit = plan.throttledInputTokens
    }
    const estimatedInput = await this.tokenEstimator.estimateTokens(
      dto.content,
      PRE_ROUTING_REFERENCE_MODEL,
    )
    if (estimatedInput > effectiveInputLimit) {
      this.usageAnalytics.logLimitHit(userId, 'INPUT_TOO_LONG').catch(() => {})
      throw new BadRequestException(fa.chat.inputTooLong(effectiveInputLimit))
    }

    // ── budget check + usage percentage (برای مسیریابی استپی Router) ────────
    // در دوره‌ی آزمایشی، بودجه‌ی روزانه هم مثل سقف‌های تعداد پیام نادیده گرفته می‌شود
    let usagePct: number
    if (inTrial) {
      usagePct = 0
    } else {
      try {
        ;({ usagePct } = await this.pricingService.assertBudget(
          userId,
          plan.priceMonthly,
          plan.planTier,
        ))
      } catch (err) {
        this.usageAnalytics.logLimitHit(userId, 'BUDGET_EXCEEDED').catch(() => {})
        throw err
      }
    }

    const allowed = plan.allowedModels
    if (allowed.length === 0)
      throw new ForbiddenException(fa.chat.modelNotAllowed)

    // ── model selection via Router — همیشه اجرا می‌شود، حتی روی انتخاب دستی ──
    // اگر کاربر «حالت بهینه» را انتخاب کرده باشد manualModel تعریف نمی‌شود و Router هر سه سطح را خودش تعیین می‌کند.
    // اگر کاربر مدل مشخصی انتخاب کرده باشد، برای پیام‌های SIMPLE باز هم بی‌صدا override می‌شود (بخش ۲/۸ PRD-model-router.md).
    const rawModelChoice = dto.model ?? conversation.model
    const manualModel =
      rawModelChoice === OPTIMAL_MODE
        ? undefined
        : resolveModelId(rawModelChoice)
    const validManualModel =
      manualModel && allowed.includes(manualModel) ? manualModel : undefined

    const lastAssistant = await this.prisma.message.findFirst({
      where: { conversationId, role: 'ASSISTANT' },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    })

    const routed = await this.modelRouter.route({
      userId,
      content: dto.content,
      hasImages: Boolean(dto.images?.length),
      allowedModels: allowed,
      manualModel: validManualModel,
      lastAssistantMessageLength: lastAssistant?.content.length,
      planId: plan.planId ?? undefined,
      usagePct,
      simpleModel: plan.simpleModel,
    })
    const modelId = routed.modelId
    this.modelRouter.log({ userId, conversationId, ...routed }).catch(() => {})

    // ── vision check (preflight) ──────────────────────────────────────────
    // نکته: وقتی rawModelChoice === 'optimal' باشد، aiModel با این نام پیدا نمی‌شود (modelRecord=null)
    // و این چک بی‌اثر می‌ماند — Router خودش تضمین می‌کند مدل انتخابی از vision پشتیبانی کند (بخش hasImages بالا).
    if (dto.images?.length) {
      const modelRecord = await this.prisma.aiModel.findFirst({
        where: { name: rawModelChoice, isActive: true },
        select: { supportsVision: true },
      })
      if (modelRecord && !modelRecord.supportsVision) {
        throw new BadRequestException(
          'این مدل از تصویر پشتیبانی نمی‌کند. لطفاً یک مدل Vision‌دار انتخاب کنید.',
        )
      }
    }

    // تخمین واقعی پیام (نه پیش‌فرض ثابت ۵۰۰) برای همان مدلی که واقعاً انتخاب شده
    // (docs/PRD-global-budget-gateway.md بخش ۹.۱)
    const estimatedForQuota = await this.tokenEstimator.estimateTokens(
      dto.content,
      modelId,
    )
    const quota = await this.tokenService.checkQuota(userId, estimatedForQuota, inTrial)
    const throttledMax = this.tokenService.resolveOutputThrottle(
      plan.outputThrottleSteps,
      todayCount,
    )
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
      const remainingNormal = Math.max(0, N - todayCount)
      const remainingThrottled = Math.max(0, N + M - todayCount)
      res.write(
        `data: ${JSON.stringify({
          info: 'stage',
          stage: messageStage,
          remainingNormal,
          remainingThrottled,
        })}\n\n`,
      )
    }

    if (throttledMax < 4096) {
      res.write(
        `data: ${JSON.stringify({ info: 'output_throttled', maxOutputTokens: throttledMax })}\n\n`,
      )
    }

    try {
      const topicId = await this.topicService.classify(dto.content)
      await this.prisma.message.create({
        data: {
          conversationId,
          userId,
          role: 'USER',
          content: dto.content,
          ...(topicId ? { topicId } : {}),
          ...(dto.images?.length ? { images: dto.images } : {}),
        },
      })

      // ── build context: global + plan context, سپس خلاصه‌ی احتمالی، سپس پیام‌های
      // «بعد از آخرین خلاصه‌سازی» (نه یک سقف ثابت پیام) — docs/PRD-chat-context-and-summarization.md بخش ۳/۴
      const chatConfig = await this.chatConfigService.getConfig()
      const systemParts: string[] = []
      if (chatConfig.globalContextMd) systemParts.push(chatConfig.globalContextMd)
      if (plan.contextMd) systemParts.push(plan.contextMd)
      if (conversation.systemPrompt) systemParts.push(conversation.systemPrompt)
      if (conversation.contextSummary) {
        systemParts.push(`خلاصه‌ی مکالمه تا این‌جا:\n${conversation.contextSummary}`)
      }

      const cutoff = conversation.summarizedUntilCreatedAt
      const recentMessages = await this.prisma.message.findMany({
        where: { conversationId, ...(cutoff ? { createdAt: { gt: cutoff } } : {}) },
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, createdAt: true },
      })

      const hasImages = Boolean(dto.images?.length)
      const coreMessages: ModelMessage[] = recentMessages.map((m, idx) => {
        const isLast = idx === recentMessages.length - 1
        if (isLast && m.role === 'USER' && hasImages) {
          const visionMsg: UserModelMessage = {
            role: 'user',
            content: [
              ...dto.images!.map((img) => ({
                type: 'image' as const,
                image: img,
              })),
              { type: 'text' as const, text: m.content },
            ],
          }
          return visionMsg
        }
        return {
          role:
            m.role === 'USER'
              ? 'user'
              : m.role === 'ASSISTANT'
                ? 'assistant'
                : 'system',
          content: m.content,
        }
      })

      const result = streamText({
        model: this.provider(modelId),
        system: systemParts.join('\n\n') || undefined,
        messages: coreMessages,
        maxOutputTokens: maxOut,
      })

      let fullContent = ''
      let reasoningActive = false
      const isFirstMessage = recentMessages.length === 1

      // fullStream (نه فقط textStream) چون مدل‌های reasoning (خانواده‌ی gpt-5) قبل از متن نهایی
      // یک فاز استدلال نامرئی دارند — با تفکیک reasoning-*/text-delta می‌شود به فرانت گفت «داره
      // فکر می‌کند» تا کاربر روی صفحه‌ی خالی/نقطه‌چین معمولی گیج نماند
      for await (const part of result.stream) {
        if (part.type === 'reasoning-start') {
          reasoningActive = true
          res.write(`data: ${JSON.stringify({ info: 'reasoning', reasoning: true })}\n\n`)
        } else if (part.type === 'reasoning-end') {
          if (reasoningActive) {
            reasoningActive = false
            res.write(`data: ${JSON.stringify({ info: 'reasoning', reasoning: false })}\n\n`)
          }
        } else if (part.type === 'text-delta') {
          if (reasoningActive) {
            reasoningActive = false
            res.write(`data: ${JSON.stringify({ info: 'reasoning', reasoning: false })}\n\n`)
          }
          fullContent += part.text
          res.write(`data: ${JSON.stringify({ chunk: part.text })}\n\n`)
        }
      }

      const usage = await result.usage
      const tokensUsed = usage.totalTokens ?? 0
      const { costToman, costUsdMicros, costInputUsdMicros, costOutputUsdMicros } =
        await this.pricingService.calcCost(usage.inputTokens ?? 0, usage.outputTokens ?? 0, modelId)

      const assistantMessage = await this.prisma.message.create({
        data: {
          conversationId,
          userId,
          role: 'ASSISTANT',
          content: fullContent,
          tokensInput: usage.inputTokens ?? 0,
          tokensOutput: usage.outputTokens ?? 0,
          costToman,
          costUsdMicros,
          costInputUsdMicros,
          costOutputUsdMicros,
          model: modelId,
        },
      })

      await Promise.all([
        this.tokenService.increment(userId, tokensUsed, quota.source),
        this.pricingService.trackCost(userId, costToman, costUsdMicros),
        this.prisma.conversation.update({
          where: { id: conversationId },
          data: {
            totalTokens: { increment: tokensUsed },
            lastMessageAt: new Date(),
          },
        }),
        // docs/PRD-growth-traction-features.md بخش ۳.۳ — denormalized، برای چک دوره‌ی آزمایشی.
        // اگر همین پیام دقیقاً trial را به پایان می‌رساند، trialEndedAt هم همین لحظه ثبت می‌شود
        // (بخش ۳.۵ — مبنای شمارش پنجره‌ی مهلت ۲۴ساعته‌ی claim کد تخفیف هدیه بعد از پایان trial)
        this.prisma.user.update({
          where: { id: userId },
          data: {
            lifetimeMessageCount: { increment: 1 },
            ...(inTrial && plan.trialMessageThreshold !== null && lifetimeMessageCount + 1 >= plan.trialMessageThreshold
              ? { trialEndedAt: new Date() }
              : {}),
          },
        }),
        // فقط بعد از موفقیت شمرده می‌شود، نه در preflight — یک درخواست ردشده
        // نباید سهمی از سقف پنجره‌ی لغزان مصرف کند (effectiveRollingLimit چون در دوره‌ی
        // آزمایشی ممکن است با مقدار همیشگی پلن فرق کند)
        ...(effectiveRollingLimit !== null
          ? [this.redis.zadd(rollingWindowKey(userId), Date.now(), `${Date.now()}:${crypto.randomUUID()}`)]
          : []),
      ])

      // فقط برای اولین پیام مکالمه: منتظر عنوان می‌مانیم (نه fire-and-forget) تا همان لحظه با یک
      // SSE event به فرانت فرستاده شود — قبلاً fire-and-forget بود و چون invalidate کوئری‌ها روی
      // [DONE] زودتر از این generateText async کامل می‌شد، فرانت تا reload بعدی عنوان تازه را نمی‌دید.
      // تنها هزینه: استریم کمی بعد از پایان متن قابل‌مشاهده بسته می‌شود (یک تولید ۴۰ توکنی)،
      // و فقط برای پیام اول هر مکالمه — نه هر پیام.
      if (!conversation.title && isFirstMessage) {
        const title = await this.generateTitle(conversationId, fullContent, modelId)
        if (title) {
          res.write(`data: ${JSON.stringify({ info: 'title', title })}\n\n`)
        }
      }

      // خلاصه‌سازی همچنان fire-and-forget می‌ماند (می‌تواند طول بکشد و روی هر پیام چک می‌شود، نه
      // فقط اولی) — عنوانِ ناشی از خلاصه‌سازی با invalidate پیام بعدی به‌روز می‌شود، نه این‌جا
      const tokensSinceSummaryText = recentMessages.map(m => m.content).join('\n') + fullContent
      const tokensSinceSummary = await this.tokenEstimator.estimateTokens(tokensSinceSummaryText, modelId)
      if (tokensSinceSummary > chatConfig.summaryTriggerTokens) {
        const messagesToSummarize = [...recentMessages, assistantMessage]
        this.summarizeConversation(
          conversationId,
          conversation.contextSummary,
          messagesToSummarize,
          modelId,
          chatConfig.summaryMaxTokens,
        ).catch(() => {})
      }

      res.write(`data: [DONE]\n\n`)
    } catch (err: unknown) {
      const isModelError = APICallError.isInstance(err)
      const message = isModelError ? fa.chat.modelUnavailable : fa.chat.streamError
      this.logger.error(
        `streamChat failed (model=${modelId}): ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      )
      res.write(
        `data: ${JSON.stringify({ error: message, code: isModelError ? 'model_unavailable' : 'stream_error' })}\n\n`,
      )
    } finally {
      res.end()
    }
  }

  // sourceText یا پاسخ اول هوش مصنوعی است (شروع مکالمه) یا یک خلاصه‌ی مکالمه (بعد از
  // خلاصه‌سازی مبتنی بر توکن — docs/PRD-chat-context-and-summarization.md بخش ۳.۴) —
  // در حالت دوم عنوان قبلی بی‌قیدوشرط بازنویسی می‌شود تا با تحول مکالمه هم‌راستا بماند.
  // برمی‌گرداند: عنوان تازه (اگر ساخته و ذخیره شد) یا null (خالی/شکست) — streamChat از این
  // مقدار برگشتی برای فرستادن یک SSE event به فرانت استفاده می‌کند تا عنوان بدون reload آپدیت شود
  private async generateTitle(
    conversationId: string,
    sourceText: string,
    modelId: string,
  ): Promise<string | null> {
    try {
      const text = await this.generateTextViaStream({
        modelId,
        system:
          'متن زیر یا پاسخ ابتدایی هوش مصنوعی در یک مکالمه است یا خلاصه‌ی یک مکالمه. ' +
          'بر اساس همین متن، یک عنوان کوتاه (حداکثر ۵ کلمه) برای این مکالمه بنویس. ' +
          'فقط عنوان، بدون توضیح یا نقل‌قول.',
        userContent: sourceText.slice(0, 500),
        // ۴۰ خیلی کم بود — مدل‌های reasoning (مثل خانواده‌ی gpt-5) بخشی از سقف خروجی را صرف
        // توکن‌های استدلال نامرئی می‌کنند؛ اگر سقف خیلی تنگ باشد ممکن است چیزی برای متن واقعی
        // نماند و خروجی خالی برگردد (دقیقاً همین اتفاق در لاگ پروداکشن دیده شد)
        maxOutputTokens: 300,
      })
      const title = text.trim().replace(/^["'«»\n]+|["'«»\n]+$/g, '')
      if (title) {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { title },
        })
        return title
      }
      this.logger.warn(`generateTitle: model returned empty title (conversation=${conversationId})`)
      return null
    } catch (err) {
      // generateText با retry داخلی، خطای واقعی (APICallError) رو مستقیم پرتاب نمی‌کنه — توی
      // RetryError.lastError پیچیده شده (تایید شده از stack trace واقعی این خطا در پروداکشن)
      const actualError = RetryError.isInstance(err) ? err.lastError : err

      if (APICallError.isInstance(actualError)) {
        // خطای واقعی سمت Liara/provider — statusCode و responseBody دقیقاً همون چیزیه که
        // سرور برگردونده، نه فقط پیام خطای کلی «Internal Server Error» AI SDK
        this.logger.error(
          `generateTitle failed (conversation=${conversationId}, model=${modelId}) — API call error: ` +
            `statusCode=${actualError.statusCode} url=${actualError.url} isRetryable=${actualError.isRetryable} ` +
            `responseBody=${actualError.responseBody ?? '(none)'} requestBodyValues=${JSON.stringify(actualError.requestBodyValues)}`,
        )
      } else {
        this.logger.error(
          `generateTitle failed (conversation=${conversationId}, model=${modelId}): ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        )
      }
      return null
    }
  }

  // خلاصه‌سازی مبتنی بر توکن — docs/PRD-chat-context-and-summarization.md بخش ۳.۴.
  // fire-and-forget از streamChat صدا زده می‌شود، نباید کاربر را برای پایان استریم معطل کند.
  private async summarizeConversation(
    conversationId: string,
    previousSummary: string | null,
    messages: { role: string; content: string; createdAt: Date }[],
    modelId: string,
    maxSummaryTokens: number,
  ): Promise<void> {
    const transcript = messages
      .map(m => `${m.role === 'USER' ? 'کاربر' : 'دستیار'}: ${m.content}`)
      .join('\n')
    const input = previousSummary
      ? `خلاصه‌ی قبلی:\n${previousSummary}\n\nادامه‌ی مکالمه:\n${transcript}`
      : transcript

    const summary = await this.generateTextViaStream({
      modelId,
      system:
        'متن زیر بخشی از یک مکالمه است (شاید همراه با خلاصه‌ی قبلی). یک خلاصه‌ی بسیار کوتاه و ' +
        'فشرده از نکات کلیدی، زمینه و درخواست‌های کاربر بنویس تا بعداً برای ادامه‌ی گفت‌وگو استفاده شود. ' +
        'فقط خلاصه، بدون مقدمه یا توضیح اضافه.',
      userContent: input,
      maxOutputTokens: maxSummaryTokens,
    })

    const trimmedSummary = summary.trim()
    if (!trimmedSummary) return

    const lastMessage = messages[messages.length - 1]
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        contextSummary: trimmedSummary,
        summarizedAt: new Date(),
        summarizedUntilCreatedAt: lastMessage.createdAt,
      },
    })

    // بازسازی عنوان بر اساس خلاصه‌ی تازه — بدون قید «اگه از قبل نداشت»، چون قطعاً تا این
    // مرحله عنوان از قبل ساخته شده و می‌خواهیم با تحول مکالمه به‌روز بماند
    await this.generateTitle(conversationId, trimmedSummary, modelId)
  }
}
