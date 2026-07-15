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
import { streamText, generateObject, APICallError, RetryError } from 'ai'
import type { ModelMessage, UserModelMessage } from 'ai'
import { ModelTier, type AiModel } from '@prisma/client'
import { z } from 'zod'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { TokenService, rollingWindowKey, type PlanLimits } from '../usage/token.service'
import { PricingService } from '../usage/pricing.service'
import { TokenEstimatorService } from '../usage/token-estimator.service'
import { ModelRouterService } from '../model-router/model-router.service'
import { UsageAnalyticsService } from '../usage-analytics/usage-analytics.service'
import { TopicService } from '../usage-analytics/topic.service'
import { CampaignService } from '../campaign/campaign.service'
import { ChatConfigService } from '../chat-config/chat-config.service'
import { LiveStatsService } from '../live-stats/live-stats.service'
import { StorageService } from '../../storage/storage.service'
import { fa } from '../../i18n/fa'
import type { Response } from 'express'
import { StreamMessageDto } from './dto/stream-message.dto'
import { validateChatImages, parseChatImageDataUrl } from '../../common/validators/chat-image.validator'
import { detectImageGenIntent, detectImageEditIntent } from './image-gen-intent'

const OPTIMAL_MODE = 'optimal'

// the input-length gate below runs before model routing (the router itself
// uses input length as a heuristic signal), so the exact model isn't known
// yet — o200k_base is the shared encoding for the whole gpt-4o family
// (including the free plan's only model) and a close-enough reference for
// this pre-routing safety check; real billing always uses the SDK's actual
// usage.inputTokens/outputTokens for the model that ends up running.
const PRE_ROUTING_REFERENCE_MODEL = 'openai/gpt-4o-mini'

// همان union که 'ai' برای LanguageModelCallOptions.reasoning می‌خواهد — به‌صورت type export
// شده نیست، پس اینجا تکرارش می‌کنیم. مقدار Plan.reasoningEffort/PlanRoutingStep.reasoningEffort
// در DTO ادمین با @IsIn به همین مقادیر محدود شده، پس این cast امن است.
type ReasoningEffort = 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

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
    private readonly liveStats: LiveStatsService,
    private readonly storageService: StorageService,
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
      // بدون timeout صریح، یک تماس معلق‌مانده به Liara منابع را نامحدود نگه می‌داشت
      // (docs/PERFORMANCE-AND-CONCURRENCY.md بخش ۸) — این‌ها کارهای کوچک و کوتاهند
      timeout: 20_000,
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

    // ── چهار چک مستقل زیر قبلاً یکی‌یکی (متوالی) اجرا می‌شدند؛ هیچ‌کدام به نتیجه‌ی
    // بقیه نیاز ندارد، پس با Promise.all موازی می‌شوند (docs/PERFORMANCE-AND-CONCURRENCY.md
    // بخش ۱) — ترتیب throw کردن خطاها بعد از این، دقیقاً مثل قبل حفظ شده (فقط fetch موازی شد)
    const [manualLimitRaw, todayCount, waitlistLimit, rollingWindow] = await Promise.all([
      this.redis.get(`manual_limit:${userId}`),
      this.tokenService.getTodayRequestCount(userId),
      this.campaignService.getWaitingDailyLimit(userId),
      this.tokenService.getRollingWindowStatus(userId, {
        rollingWindowLimit: effectiveRollingLimit,
        rollingWindowHours: effectiveRollingHours ?? plan.rollingWindowHours,
      }),
    ])

    // ── manual limit set by admin ──────────────────────────────────────────
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

    // ── سقف موقت لیست انتظار کمپین سافت‌لانچ — بخش ۱۸.۴ ────────────────────
    if (waitlistLimit !== null && todayCount >= waitlistLimit) {
      this.usageAnalytics.logLimitHit(userId, 'DAILY_MESSAGE_BLOCKED').catch(() => {})
      throw new HttpException({ message: fa.waitlist.limitReached, waitlisted: true }, 429)
    }

    // ── three-zone daily message limit ────────────────────────────────────
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
    // در دوره‌ی آزمایشی، بودجه‌ی روزانه هم مثل سقف‌های تعداد پیام نادیده گرفته می‌شود.
    // docs/PRD-pay-as-you-go-wallet.md — پلن PAYG اصلاً بودجه‌ی درصدی priceMonthly ندارد؛
    // گیت واقعی مصرف این پلن چند خط پایین‌تر (بعد از مشخص‌شدن مدل) با موجودی کیف‌پول است.
    let usagePct: number
    if (inTrial || plan.isPayAsYouGo) {
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

    // اینجا زودتر از قبل گرفته می‌شود (قبلاً پایین‌تر، کنار اعتبارسنجی عکس بود) چون
    // implicitImageGenEnabled همین‌جا لازم است — کش ۶۰ ثانیه‌ای درون‌حافظه‌ای، هزینه‌ی اضافه ندارد
    const chatConfig = await this.chatConfigService.getConfig()

    // docs/PRD-chat-images.md بخش ۵.۵ — تولید عکس مسیر کاملاً جدایی است: نه Router (طبقه‌بندی
    // SIMPLE/MEDIUM/COMPLEX بی‌معنی است)، نه vision-preflight، نه سهمیه‌ی توکنی خروجی. مدل یا
    // صراحتاً انتخاب شده (toggle فرانت) یا از روی نیت پیام تشخیص داده می‌شود (heuristic، قابل
    // خاموش‌کردن از ادمین) — هر سه حالت به همان مسیر می‌روند.
    // دو heuristic جدا: وقتی کاربر عکس نفرستاده («تولید از صفر» — اسم+فعل مثل «عکس گربه بکش»)
    // در برابر وقتی عکس فرستاده («ویرایش/ترکیب همون عکس» — فقط فعل کافیه، مثل «سفیدش کن»،
    // چون خودِ عکس ضمیمه‌شده موضوع رو مشخص می‌کنه). قبلاً وقتی عکس بود اصلاً implicit چک نمی‌شد
    // که یعنی «سفیدش کن» روی یک عکس آپلودی به‌جای ویرایش، به مسیر توضیح/تحلیل معمولی می‌رفت.
    const implicitImageGenTriggered =
      !dto.images?.length && chatConfig.implicitImageGenEnabled && detectImageGenIntent(dto.content)
    const implicitImageEditTriggered =
      Boolean(dto.images?.length) && chatConfig.implicitImageGenEnabled && detectImageEditIntent(dto.content)
    if (dto.generateImage || implicitImageGenTriggered || implicitImageEditTriggered) {
      return this.handleImageGeneration(res, conversationId, userId, dto, plan)
    }

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
      reasoningEffort: plan.reasoningEffort,
      isPayAsYouGo: plan.isPayAsYouGo,
    })
    const modelId = routed.modelId
    this.modelRouter.log({ userId, conversationId, ...routed }).catch(() => {})

    // ── تصاویر: اعتبارسنجی امنیتی + چک vision (preflight) ──────────────────
    // docs/PRD-chat-images.md بخش ۵.۱ — قبل از این، هیچ چک فرمت/حجم/magic-bytes ای
    // روی dto.images نبود؛ سقف‌ها هم از تنظیمات ادمین (ChatConfig) خوانده می‌شوند، نه ثابت در کد.
    // (chatConfig بالاتر گرفته شده)
    if (dto.images?.length) {
      validateChatImages(dto.images, {
        maxCount: chatConfig.maxImagesPerMessage,
        maxSizeMb: chatConfig.maxImageSizeMb,
        allowedFormats: chatConfig.allowedImageFormats as string[],
      })

      // نکته: وقتی rawModelChoice === 'optimal' باشد، aiModel با این نام پیدا نمی‌شود (modelRecord=null)
      // و این چک بی‌اثر می‌ماند — Router خودش تضمین می‌کند مدل انتخابی از vision پشتیبانی کند (بخش hasImages بالا).
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
    // docs/PRD-pay-as-you-go-wallet.md — PAYG سقف توکن رایگان/ماهانه ندارد؛ همان bypass موجود
    // برای دوره‌ی آزمایشی اینجا هم استفاده می‌شود (checkQuota با bypass=true چیزی نمی‌سنجد)
    const quota = await this.tokenService.checkQuota(
      userId,
      plan,
      estimatedForQuota,
      inTrial || plan.isPayAsYouGo,
    )
    const throttledMax = this.tokenService.resolveOutputThrottle(
      plan.outputThrottleSteps,
      todayCount,
    )
    let maxOut = Math.min(quota.remaining, throttledMax)
    // further restrict output if in throttled zone
    if (messageStage === 'throttled' && plan.throttledOutputTokens) {
      maxOut = Math.min(maxOut, plan.throttledOutputTokens)
    }

    // ── گیت مصرف PAYG — بدون بودجه‌ی درصدی، فقط موجودی واقعی کیف‌پول ────────
    // docs/PRD-pay-as-you-go-wallet.md بخش ۵.۲ — تخمین بدبینانه (فرض مصرف کامل maxOut خروجی)
    // تا هیچ‌وقت پیامی اجازه‌ی شروع پیدا نکند که موجودی برایش کافی نیست (بدون موجودی منفی)
    if (plan.isPayAsYouGo) {
      const markup = plan.payAsYouGoMarkup ?? 1.3
      const worstCase = await this.pricingService.calcCost(estimatedForQuota, maxOut, modelId)
      const balance = await this.pricingService.getWalletBalance(userId)
      if (balance < Math.ceil(worstCase.costToman * markup)) {
        throw new HttpException(
          { message: fa.payAsYouGo.insufficientBalance, stage: 'wallet_insufficient' },
          402,
        )
      }
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

    // برای بنر «چند نفر الان دارن چت می‌کنن» توی ادمین — فقط شمارنده، بدون هیچ محتوایی
    const streamToken = await this.liveStats.trackStreamStart()
    // این مقدار اولیه فقط برای خطاهای زودهنگام (قبل از رسیدن به streamText) استفاده می‌شود؛
    // درست قبل از streamText دوباره ست می‌شود تا «تأخیر چت» واقعاً فقط زمان مدل را اندازه بگیرد
    // (نه topic classify/DB/عنوان‌سازی که قبلاً به‌اشتباه داخل همین بازه حساب می‌شدند)
    let chatCallStart = Date.now()

    try {
      const topicId = await this.topicService.classify(dto.content)

      // docs/PRD-chat-images.md بخش ۵.۴ — برای مدل همچنان base64 خام (dto.images) استفاده
      // می‌شود (پایین‌تر)؛ اینجا فقط برای ماندگاری در DB به MinIO آپلود می‌شود. اگر یک عکس
      // آپلودش شکست بخورد، فقط همان یکی نادیده گرفته می‌شود — کل پیام fail نمی‌شود.
      const persistedImageKeys = dto.images?.length
        ? (
            await Promise.all(
              dto.images.map(async (dataUrl) => {
                const parsed = parseChatImageDataUrl(dataUrl)
                if (!parsed) return null
                try {
                  return await this.storageService.uploadImage(parsed.buffer, parsed.ext, conversationId)
                } catch (err) {
                  this.logger.warn(`MinIO upload failed, image will not be persisted: ${(err as Error).message}`)
                  return null
                }
              }),
            )
          ).filter((key): key is string => key !== null)
        : []

      await this.prisma.message.create({
        data: {
          conversationId,
          userId,
          role: 'USER',
          content: dto.content,
          ...(topicId ? { topicId } : {}),
          ...(persistedImageKeys.length ? { images: persistedImageKeys } : {}),
        },
      })

      // ── build context: global + plan context, سپس خلاصه‌ی احتمالی، سپس پیام‌های
      // «بعد از آخرین خلاصه‌سازی» (نه یک سقف ثابت پیام) — docs/PRD-chat-context-and-summarization.md بخش ۳/۴
      // (chatConfig بالاتر، قبل از preflight تصاویر، همین‌جا گرفته شده — کش ۶۰ ثانیه‌ای سرویس)
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

      chatCallStart = Date.now()
      const result = streamText({
        model: this.provider(modelId),
        system: systemParts.join('\n\n') || undefined,
        messages: coreMessages,
        maxOutputTokens: maxOut,
        // chunkMs نه totalMs — پاسخ‌های بلند مجازند طول بکشند، فقط اگر بین دو chunk بیش از
        // این مدت سکوت شد (گیرکردن واقعی اتصال) قطع شود (docs/PERFORMANCE-AND-CONCURRENCY.md بخش ۸)
        timeout: { chunkMs: 30_000 },
        // میزان reasoning effort قابل‌تنظیم در ادمین — پیش‌فرض پلن، با امکان override به‌ازای
        // استپ بودجه‌ای (مسیریابی مدل). null یعنی از پیش‌فرض provider استفاده شود (کلید ست نمی‌شود)
        ...(routed.reasoningEffort ? { reasoning: routed.reasoningEffort as ReasoningEffort } : {}),
      })

      let fullContent = ''
      let reasoningActive = false
      const isFirstMessage = recentMessages.length === 1

      // fullStream (نه فقط textStream) چون مدل‌های reasoning (خانواده‌ی gpt-5) قبل از متن نهایی
      // یک فاز استدلال نامرئی دارند — با تفکیک reasoning-*/text-delta می‌شود به فرانت گفت «داره
      // فکر می‌کند» تا کاربر روی صفحه‌ی خالی/نقطه‌چین معمولی گیج نماند. reasoning-delta علاوه
      // بر سیگنال شروع/پایان، متن واقعی استدلال را هم دارد (اگر Liara/مدل آن را برگرداند) —
      // این را هم جدا استریم می‌کنیم تا فرانت بتواند کم‌رنگ/محو نشانش بدهد.
      for await (const part of result.stream) {
        if (part.type === 'reasoning-start') {
          reasoningActive = true
          res.write(`data: ${JSON.stringify({ info: 'reasoning', reasoning: true })}\n\n`)
        } else if (part.type === 'reasoning-delta') {
          // فیلد جدا از «chunk» عمداً — چون فرانت هر پیامی با فیلد chunk را مستقیم به متن
          // اصلی پاسخ اضافه می‌کند؛ استفاده از همان اسم این متن استدلال را قاطی جواب می‌کرد
          res.write(`data: ${JSON.stringify({ info: 'reasoning-chunk', reasoningChunk: part.text })}\n\n`)
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
      // اینجا دقیقاً «زمان مدل» است — از شروع streamText تا مصرف کامل استریم (reasoning + متن)،
      // بدون DB/عنوان‌سازی/خلاصه‌سازی که بعدش می‌آیند (docs/PERFORMANCE-AND-CONCURRENCY.md)
      this.liveStats.recordLiaraCall('chat', true, Date.now() - chatCallStart).catch(() => {})
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

      // docs/PRD-pay-as-you-go-wallet.md بخش ۵.۲ — هزینه‌ی واقعی × ضریب پلن از کیف‌پول کم می‌شود؛
      // پیش‌چک بدبینانه‌ی بالاتر (maxOut کامل) تضمین می‌کند این تقریباً هیچ‌وقت insufficient نشود،
      // ولی خطا اینجا فقط لاگ می‌شود نه throw — پیام و پاسخ قبلاً موفق برای کاربر تمام شده‌اند
      if (plan.isPayAsYouGo) {
        this.pricingService
          .debitWallet(userId, costToman, plan.payAsYouGoMarkup ?? 1.3, fa.payAsYouGo.messageDebitDescription, {
            messageId: assistantMessage.id,
            conversationId,
          })
          .then((ok) => {
            if (!ok) this.logger.error(`debitWallet: insufficient balance for user=${userId} message=${assistantMessage.id}`)
          })
          .catch((err) => this.logger.error(`debitWallet failed for user=${userId} message=${assistantMessage.id}`, err))
      }

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
      this.liveStats.recordLiaraCall('chat', false, Date.now() - chatCallStart).catch(() => {})
    } finally {
      res.end()
      this.liveStats.trackStreamEnd(streamToken).catch(() => {})
    }
  }

  // یک مدل تولید عکس ممکن است چند ردیف با کیفیت/قیمت مختلف داشته باشد (مثلاً low/medium/high
  // خانواده‌ی gpt-image) — به‌جای اینکه کاربر خودش کیفیت را انتخاب کند، از روی متن پیام تشخیص
  // می‌دهیم که این تصویر چقدر باید دقیق/پیچیده باشد، و اندازه‌ی مناسب (مربع/عمودی/افقی) را هم
  // از توصیف کاربر درمی‌آوریم. تماس سبک و ارزان است (همان الگوی classifyWithLLM در model-router).
  private async classifyImagePrompt(
    prompt: string,
    userId: string,
  ): Promise<{ tier: ModelTier; size: '1024x1024' | '1024x1536' | '1536x1024' }> {
    const fallback = { tier: ModelTier.MEDIUM, size: '1024x1024' as const }
    try {
      const { object, usage } = await generateObject({
        model: this.provider(PRE_ROUTING_REFERENCE_MODEL),
        schema: z.object({
          tier: z.enum(['SIMPLE', 'MEDIUM', 'COMPLEX']),
          size: z.enum(['1024x1024', '1024x1536', '1536x1024']),
        }),
        system: `درخواست تولید عکس کاربر را از نظر پیچیدگی/کیفیت لازم طبقه‌بندی کن.
SIMPLE: آیکون ساده، شکل مینیمال، طرح خیلی ابتدایی — کیفیت پایین کافی است.
MEDIUM: یک صحنه‌ی معمولی، تصویر توضیحی، بدون جزئیات فوق‌العاده دقیق.
COMPLEX: تصویر فوتورئالیستیک، جزئیات زیاد، متن/عدد دقیق داخل تصویر، ترکیب‌بندی پیچیده.
size را هم از توی توصیف تشخیص بده: اگر صحنه‌ی عمودی/پرتره/شخص از نزدیک بود → "1024x1536"،
اگر منظره/صحنه‌ی افقی/بنر بود → "1536x1024"، در غیر این صورت (یا نامشخص) → "1024x1024".
فقط JSON برگردان.`,
        messages: [{ role: 'user', content: prompt.slice(0, 1000) }],
        abortSignal: AbortSignal.timeout(8_000),
      })
      // این هم یک تماس واقعی به Liara است و هزینه‌ی واقعی دارد — قبلاً اینجا ردیابی نمی‌شد،
      // یعنی روی Liara شارژ می‌شد ولی توی حساب‌وکتاب داخلی ما اصلاً دیده نمی‌شد
      if (usage) {
        const { costToman, costUsdMicros } = await this.pricingService.calcCost(
          usage.inputTokens ?? 0,
          usage.outputTokens ?? 0,
          PRE_ROUTING_REFERENCE_MODEL,
        )
        this.pricingService.trackCost(userId, costToman, costUsdMicros).catch(() => {})
      }
      return object
    } catch (err) {
      this.logger.warn(`Image prompt classification failed, falling back to MEDIUM/1024x1024: ${(err as Error).message}`)
      return fallback
    }
  }

  // بین چند ردیف supportsImageGen موجود (که ممکن است کیفیت/اندازه‌ی متفاوتی داشته باشند)،
  // نزدیک‌ترین به (idealTier, idealSize) را انتخاب می‌کند — تطابق کیفیت وزن بیشتری از تطابق
  // اندازه دارد، چون تفاوت قیمتی کیفیت معمولاً بسیار بیشتر از تفاوت قیمتی اندازه است
  private rankImageModelCandidates(
    candidates: AiModel[],
    idealTier: ModelTier,
    idealSize: string,
  ): AiModel[] {
    const tierScore = (t: string | null) => (t === idealTier ? 2 : 0)
    const sizeScore = (s: string | null) => (s === idealSize ? 1 : 0)
    return [...candidates].sort((a, b) => {
      const scoreDiff = (tierScore(b.tier) + sizeScore(b.imageGenSize)) - (tierScore(a.tier) + sizeScore(a.imageGenSize))
      if (scoreDiff !== 0) return scoreDiff
      return a.sortOrder - b.sortOrder
    })
  }

  // تخمین محافظه‌کارانه (نه دقیق) — چون هزینه‌ی واقعی فقط بعد از دریافت usage از provider معلوم
  // می‌شود، برای پیش‌چک PAYG (قبل از فراخوانی) باید یک سقفِ بدترین‌حالت تخمین بزنیم. عمداً
  // بزرگ‌تر از واقعیت است تا کاربر رد نشود از قلم بیفتد و بعداً موجودی‌اش منفی شود.
  // اعداد توکن خروجی از مستندات OpenAI برای gpt-image (low/medium/high در 1024×1024) گرفته شده؛
  // برای ابعاد غیرمربعی یا مدل‌های دیگر همچنان یک سقفِ بالا (نه دقیق) کافی است.
  private estimateWorstCaseImageUsd(model: AiModel, hasInputImages: boolean): number {
    const OUTPUT_TOKENS_BY_TIER: Record<string, number> = { SIMPLE: 300, MEDIUM: 1100, COMPLEX: 4200 }
    const outputTokens = OUTPUT_TOKENS_BY_TIER[model.tier] ?? 4200
    const textTokens = 300 // سقف بالا برای یک prompt معمولی
    const imageInputTokens = hasInputImages ? 1500 : 0 // فقط حالت ویرایش — تخمین سقف بالا هر عکس ورودی
    return (
      (textTokens * model.inputPricePerM) / 1_000_000 +
      (imageInputTokens * (model.imageGenInputImagePricePerM ?? 0)) / 1_000_000 +
      (outputTokens * (model.imageGenOutputImagePricePerM ?? 0)) / 1_000_000
    )
  }

  private async firstAffordable(
    rankedCandidates: AiModel[],
    balanceToman: number,
    markup: number,
    hasInputImages: boolean,
  ): Promise<AiModel | null> {
    for (const candidate of rankedCandidates) {
      const { costToman } = await this.pricingService.calcFlatCostToman(
        this.estimateWorstCaseImageUsd(candidate, hasInputImages),
      )
      if (balanceToman >= Math.ceil(costToman * markup)) return candidate
    }
    return null
  }

  private async callImagesApi(
    path: '/images/generations' | '/images/edits',
    body: Record<string, unknown> | FormData,
  ): Promise<{
    base64: string
    usage: { textInputTokens: number; imageInputTokens: number; outputTokens: number }
  }> {
    const baseUrl = this.config.get<string>('LIARA_AI_BASE_URL')!
    const apiKey = this.config.get<string>('LIARA_API_KEY')!
    const isFormData = body instanceof FormData

    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      },
      body: isFormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Liara images API ${path} failed (${res.status}): ${text.slice(0, 300)}`)
    }

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string }>
      usage?: {
        input_tokens_details?: { text_tokens?: number; image_tokens?: number }
        output_tokens?: number
      }
    }
    const base64 = json.data?.[0]?.b64_json
    if (!base64) throw new Error(`Liara images API ${path} returned no image data`)

    return {
      base64,
      // اگر provider اصلاً usage برنگرداند (بعضی مدل‌ها/gatewayها ممکن است ندهند)، صفر می‌شود —
      // یعنی آن بخش هزینه صفر حساب می‌شود؛ بهتر از crash کردن، ولی باید توی لاگ مشخص باشد
      usage: {
        textInputTokens: json.usage?.input_tokens_details?.text_tokens ?? 0,
        imageInputTokens: json.usage?.input_tokens_details?.image_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
      },
    }
  }

  // تولید از صفر — بدون عکس ورودی (docs: /v1/images/generations)
  private async generateImageRaw(params: { modelId: string; prompt: string; size?: string; quality?: string }) {
    return this.callImagesApi('/images/generations', {
      model: params.modelId,
      prompt: params.prompt,
      n: 1,
      ...(params.size ? { size: params.size } : {}),
      ...(params.quality ? { quality: params.quality } : {}),
    })
  }

  // ویرایش/ترکیب چند عکس موجود با یک prompt (docs: /v1/images/edits) — کاربر خودش عکس(ها) را
  // فرستاده و می‌خواهد ویرایش/ترکیب شوند، نه یک تصویر کاملاً جدید
  private async editImageRaw(params: {
    modelId: string
    prompt: string
    images: Buffer[]
    size?: string
    quality?: string
  }) {
    const form = new FormData()
    form.append('model', params.modelId)
    form.append('prompt', params.prompt)
    if (params.size) form.append('size', params.size)
    if (params.quality) form.append('quality', params.quality)
    // فرمت چندفایلی استاندارد multipart — یک فایل: کلید ساده «image»، چند فایل: کلید تکرارشونده‌ی
    // «image[]» (همون قراردادی که OpenAI/gpt-image-1 می‌پذیرد)
    const imageKey = params.images.length > 1 ? 'image[]' : 'image'
    params.images.forEach((buf, i) => {
      form.append(imageKey, new Blob([new Uint8Array(buf)], { type: 'image/png' }), `image-${i}.png`)
    })
    return this.callImagesApi('/images/edits', form)
  }

  // docs/PRD-chat-images.md بخش ۵.۵ — مسیر تولید عکس: مستقل از streamText/Router. نتیجه یک‌جا
  // (نه تدریجی) از طریق یک رویداد SSE برگردانده می‌شود، نه چانک‌به‌چانک مثل متن.
  private async handleImageGeneration(
    res: Response,
    conversationId: string,
    userId: string,
    dto: StreamMessageDto,
    plan: PlanLimits,
  ): Promise<void> {
    // انتخاب دستی (toggle صریح با یک مدل مشخص) اگر معتبر و supportsImageGen باشد همچنان در
    // اولویت است — راه فرار برای انتخاب دقیق. وگرنه (حالت پیش‌فرض/تشخیص ضمنی)، خودمان از روی
    // متن پیام تشخیص می‌دهیم این عکس چقدر باید پیچیده/باکیفیت باشد و بین ردیف‌های موجود
    // (که ممکن است چند سطح کیفیت/قیمت مختلف از یک یا چند مدل باشند) بهترین را انتخاب می‌کنیم.
    // اگر کاربر عکس هم فرستاده باشد، این یک درخواست «ویرایش/ترکیب» است (images/edits) نه تولید
    // از صفر — دقیقاً مثل مثال gpt-image-1-mini (چند عکس ورودی + prompt → یک عکس جدید)
    const hasInputImages = Boolean(dto.images?.length)

    // این مسیر (برخلاف چت معمولی) زودتر return می‌کند و هیچ‌وقت به کد ذخیره‌سازی پیام کاربر
    // در streamChat() نمی‌رسد — پس اگر اینجا خودمان پیام کاربر را ذخیره نکنیم، بعد از هر
    // invalidate/refetch (مثلاً پایان استریم) کل پیام کاربر (متن + عکس‌های ورودی) ناپدید می‌شود،
    // چون اصلاً هیچ‌وقت توی دیتابیس نبوده — فقط توی کش optimistic فرانت بوده
    const persistedInputImageKeys = dto.images?.length
      ? (
          await Promise.all(
            dto.images.map(async (dataUrl) => {
              const parsed = parseChatImageDataUrl(dataUrl)
              if (!parsed) return null
              try {
                return await this.storageService.uploadImage(parsed.buffer, parsed.ext, conversationId)
              } catch (err) {
                this.logger.warn(`MinIO upload failed for input image, keeping raw base64: ${(err as Error).message}`)
                return dataUrl
              }
            }),
          )
        ).filter((key): key is string => key !== null)
      : []

    await this.prisma.message.create({
      data: {
        conversationId,
        userId,
        role: 'USER',
        content: dto.content,
        ...(persistedInputImageKeys.length ? { images: persistedInputImageKeys } : {}),
      },
    })

    const requestedModel = dto.model && dto.model !== OPTIMAL_MODE ? resolveModelId(dto.model) : undefined
    const explicitModelRecord =
      requestedModel && plan.allowedModels.includes(requestedModel)
        ? await this.prisma.aiModel.findFirst({
            where: { name: requestedModel, isActive: true, supportsImageGen: true },
          })
        : null

    let modelRecord = explicitModelRecord
    if (!modelRecord) {
      const candidates = await this.prisma.aiModel.findMany({
        where: { name: { in: plan.allowedModels }, supportsImageGen: true, isActive: true },
        orderBy: { sortOrder: 'asc' },
      })
      if (!candidates.length) {
        throw new BadRequestException(fa.chat.imageGenNotSupported)
      }

      const { tier: idealTier, size: idealSize } = await this.classifyImagePrompt(dto.content, userId)
      const ranked = this.rankImageModelCandidates(candidates, idealTier, idealSize)

      if (plan.isPayAsYouGo) {
        const markup = plan.payAsYouGoMarkup ?? 1.3
        const balance = await this.pricingService.getWalletBalance(userId)
        // بین همه‌ی گزینه‌ها (به ترتیب بهترین تطابق کیفیت اول)، اولین گزینه‌ای که کیف‌پول
        // برایش کافی است انتخاب می‌شود — بهترین کیفیتی که کاربر واقعاً می‌تواند بپردازد،
        // نه لزوماً ارزان‌ترین. اگر even ارزان‌ترین گزینه هم کافی نبود، یعنی هیچ‌کدام از
        // کل لیست (با هر ترتیبی) قابل‌پرداخت نیست
        const affordable = await this.firstAffordable(ranked, balance, markup, hasInputImages)
        if (!affordable) {
          throw new HttpException(
            { message: fa.payAsYouGo.insufficientBalance, stage: 'wallet_insufficient' },
            402,
          )
        }
        modelRecord = affordable
      } else {
        modelRecord = ranked[0]
      }
    } else if (plan.isPayAsYouGo) {
      // انتخاب دستی صریح — کیفیت را خودمان پایین نمی‌آوریم (کاربر دقیقاً همین را خواسته)،
      // فقط چک می‌کنیم کیف‌پول کافی هست یا نه
      const markup = plan.payAsYouGoMarkup ?? 1.3
      const balance = await this.pricingService.getWalletBalance(userId)
      const affordable = await this.firstAffordable([modelRecord], balance, markup, hasInputImages)
      if (!affordable) {
        throw new HttpException(
          { message: fa.payAsYouGo.insufficientBalance, stage: 'wallet_insufficient' },
          402,
        )
      }
    }
    const modelId = modelRecord.name

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    // وقتی toggle صریح فرانت فعال بوده، فرانت از قبل isGeneratingImage را خودش true کرده —
    // ولی وقتی تشخیص ضمنی/heuristic باعث اومدن به این مسیر شده، فرانت هیچ‌وقت از قبل خبر نداشت
    // این پیام قراره تولید عکس بشه؛ بدون این رویداد، لودینگ آماده‌سازی عکس اصلاً نشون داده نمی‌شد
    res.write(`data: ${JSON.stringify({ info: 'image-generation-started' })}\n\n`)

    const streamToken = await this.liveStats.trackStreamStart()
    const callStart = Date.now()

    try {
      const result = hasInputImages
        ? await this.editImageRaw({
            modelId,
            prompt: dto.content,
            images: (dto.images ?? [])
              .map((dataUrl) => parseChatImageDataUrl(dataUrl))
              .filter((p): p is NonNullable<typeof p> => p !== null)
              .map((p) => p.buffer),
            size: modelRecord.imageGenSize ?? undefined,
            quality: modelRecord.imageGenQuality ?? undefined,
          })
        : await this.generateImageRaw({
            modelId,
            prompt: dto.content,
            size: modelRecord.imageGenSize ?? undefined,
            quality: modelRecord.imageGenQuality ?? undefined,
          })
      this.liveStats.recordLiaraCall('chat', true, Date.now() - callStart).catch(() => {})

      const { costToman, costUsdMicros, costInputUsdMicros, costOutputUsdMicros } =
        await this.pricingService.calcImageGenCost(result.usage, modelRecord)
      const buffer = Buffer.from(result.base64, 'base64')

      let imageKey: string | null = null
      try {
        imageKey = await this.storageService.uploadImage(buffer, 'png', conversationId)
      } catch (err) {
        this.logger.warn(`MinIO upload failed for generated image: ${(err as Error).message}`)
      }

      // اگر آپلود به MinIO fail بشه، عکس رو کامل از دست نمی‌دیم — همون base64 خام رو ذخیره
      // می‌کنیم (فرمت قدیمی که کد خواندنش رو از قبل پشتیبانی می‌کند، isStorageKey تشخیصش می‌ده)؛
      // وگرنه پیام دستیار با content خالی و بدون عکس، کاملاً نامرئی می‌شد (نه متن نه عکس)
      const persistedImage = imageKey ?? `data:image/png;base64,${result.base64}`

      const assistantMessage = await this.prisma.message.create({
        data: {
          conversationId,
          userId,
          role: 'ASSISTANT',
          content: '',
          images: [persistedImage],
          costToman,
          costUsdMicros,
          costInputUsdMicros,
          costOutputUsdMicros,
          model: modelId,
        },
      })

      await Promise.all([
        this.pricingService.trackCost(userId, costToman, costUsdMicros),
        this.prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date() },
        }),
      ])

      if (plan.isPayAsYouGo) {
        this.pricingService
          .debitWallet(userId, costToman, plan.payAsYouGoMarkup ?? 1.3, fa.payAsYouGo.messageDebitDescription, {
            messageId: assistantMessage.id,
            conversationId,
            kind: 'image-generation',
          })
          .then((ok) => {
            if (!ok) this.logger.error(`debitWallet: insufficient balance for user=${userId} message=${assistantMessage.id}`)
          })
          .catch((err) => this.logger.error(`debitWallet failed (image-gen) for user=${userId}`, err))
      }

      const dataUrl = `data:image/png;base64,${result.base64}`
      res.write(
        `data: ${JSON.stringify({ info: 'image-generated', image: dataUrl, messageId: assistantMessage.id })}\n\n`,
      )
      res.write('data: [DONE]\n\n')
    } catch (err) {
      this.liveStats.recordLiaraCall('chat', false, Date.now() - callStart).catch(() => {})
      this.logger.error(`image generation failed: ${(err as Error).message}`)
      res.write(`data: ${JSON.stringify({ error: fa.chat.imageGenFailed })}\n\n`)
    } finally {
      res.end()
      this.liveStats.trackStreamEnd(streamToken).catch(() => {})
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
    const callStart = Date.now()
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
      this.liveStats.recordLiaraCall('title', true, Date.now() - callStart).catch(() => {})
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
      this.liveStats.recordLiaraCall('title', false, Date.now() - callStart).catch(() => {})
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

    const callStart = Date.now()
    let summary: string
    try {
      summary = await this.generateTextViaStream({
        modelId,
        system:
          'متن زیر بخشی از یک مکالمه است (شاید همراه با خلاصه‌ی قبلی). یک خلاصه‌ی بسیار کوتاه و ' +
          'فشرده از نکات کلیدی، زمینه و درخواست‌های کاربر بنویس تا بعداً برای ادامه‌ی گفت‌وگو استفاده شود. ' +
          'فقط خلاصه، بدون مقدمه یا توضیح اضافه.',
        userContent: input,
        maxOutputTokens: maxSummaryTokens,
      })
      this.liveStats.recordLiaraCall('summary', true, Date.now() - callStart).catch(() => {})
    } catch (err) {
      this.liveStats.recordLiaraCall('summary', false, Date.now() - callStart).catch(() => {})
      throw err
    }

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
