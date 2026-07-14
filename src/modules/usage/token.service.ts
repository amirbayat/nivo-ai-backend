import { HttpException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisService } from '../../redis/redis.service'
import { PrismaService } from '../../prisma/prisma.service'
import { fa } from '../../i18n/fa'

export interface TokenCheckResult {
  allowed: boolean
  source: 'free' | 'paid'
  remaining: number
}

export interface ThrottleStep {
  afterMessages: number
  maxOutputTokens: number
}

export interface PlanLimits {
  planId: string | null // null فقط برای fallback بدون پلن رایگان در دیتابیس
  dailyFreeTokens: number
  monthlyTotalTokens: number
  allowedModels: string[]
  maxInputTokens: number
  outputThrottleSteps: ThrottleStep[]
  priceMonthly: number
  planTier: string
  planName: string
  simpleModel: string | null
  dailyMessageLimit: number | null
  throttledMessageCount: number | null
  throttledInputTokens: number | null
  throttledOutputTokens: number | null
  rollingWindowLimit: number | null
  rollingWindowHours: number
  contextMd: string | null // context اختصاصی این پلن (docs/PRD-chat-context-and-summarization.md بخش ۴.۳)
  // دوره‌ی آزمایشی کاربر تازه (docs/PRD-growth-traction-features.md بخش ۳)
  trialMessageThreshold: number | null
  trialDailyMessageLimit: number | null
  trialThrottledMessageCount: number | null
  trialRollingWindowLimit: number | null
  trialRollingWindowHours: number | null
}

// Iran Standard Time = UTC+3:30 (no DST)
const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000

function iranDate(): string {
  return new Date(Date.now() + IRAN_OFFSET_MS).toISOString().slice(0, 10)
}

function iranMonth(): string {
  return new Date(Date.now() + IRAN_OFFSET_MS).toISOString().slice(0, 7)
}

function todayKey(userId: string) {
  return `token:free:${userId}:${iranDate()}`
}

function monthKey(userId: string) {
  return `token:paid:${userId}:${iranMonth()}`
}

function dailyPaidKey(userId: string) {
  return `token:dailypaid:${userId}:${iranDate()}`
}

function reqKey(userId: string) {
  return `token:req:${userId}:${iranDate()}`
}

function planCacheKey(userId: string) {
  return `plan:${userId}`
}

export function rollingWindowKey(userId: string) {
  return `ratelimit:msg:${userId}`
}

// نیمه‌شب بعدیِ به‌وقت ایران، به ISO/UTC برای پاسخ به کلاینت
export function nextIranMidnightISO(): string {
  const iranNow = new Date(Date.now() + IRAN_OFFSET_MS)
  const iranMidnight = new Date(iranNow)
  iranMidnight.setUTCDate(iranMidnight.getUTCDate() + 1)
  iranMidnight.setUTCHours(0, 0, 0, 0)
  return new Date(iranMidnight.getTime() - IRAN_OFFSET_MS).toISOString()
}

// env-based input token limits per tier (override plan DB value when set)
const TIER_INPUT_LIMITS: Record<string, string> = {
  free: 'MAX_INPUT_TOKENS_FREE',
  pro: 'MAX_INPUT_TOKENS_PRO',
  premium: 'MAX_INPUT_TOKENS_PREMIUM',
}

@Injectable()
export class TokenService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // bypass=true در دوره‌ی آزمایشی کاربر تازه (chat.service.ts, inTrial) — سومین و آخرین مسیر
  // محدودیت توکن که باید در trial نادیده گرفته شود (بعد از سقف تعداد پیام و بودجه‌ی تومانی).
  // plan از caller گرفته می‌شود (نه دوباره getCachedPlan) — قبلاً همین درخواست یک‌بار plan را
  // خوانده بود، خواندن دوباره فقط یک رفت‌وبرگشت Redis تکراری بود (docs/PERFORMANCE-AND-CONCURRENCY.md بخش ۱)
  async checkQuota(userId: string, plan: PlanLimits, estimated = 500, bypass = false): Promise<TokenCheckResult> {
    if (bypass) return { allowed: true, source: 'free', remaining: Number.MAX_SAFE_INTEGER }

    const [freeUsed, paidUsed] = await Promise.all([
      this.redis.get(todayKey(userId)).then(v => Number(v) || 0),
      this.redis.get(monthKey(userId)).then(v => Number(v) || 0),
    ])

    const freeRemaining = plan.dailyFreeTokens - freeUsed
    if (freeRemaining >= estimated) {
      return { allowed: true, source: 'free', remaining: freeRemaining }
    }

    const paidRemaining = plan.monthlyTotalTokens - paidUsed
    if (paidRemaining >= estimated) {
      return { allowed: true, source: 'paid', remaining: paidRemaining }
    }

    // stage: 'quota_exceeded' — تا useChat.ts فرانت این خطا را «نوع محدودیت» تشخیص بدهد و به‌جای
    // نمایش داخل چت، به همان باکس تایمردار (MessageLimitBanner) واگذارش کند
    throw new HttpException(
      {
        message: fa.chat.quotaExceeded,
        stage: 'quota_exceeded',
        planTier: plan.planTier,
        resetAt: nextIranMidnightISO(),
      },
      429,
    )
  }

  // نسخه‌ی «فقط نمایش» چک بالا — بدون throw، برای بنر محدودیت (usage.controller) که باید همین
  // وضعیت را پیش از تلاش کاربر برای ارسال نشان دهد، نه فقط بعد از یک تلاش ناموفق
  async getTokenQuotaStatus(
    userId: string,
    plan: PlanLimits,
    inTrial: boolean,
  ): Promise<{ blocked: boolean; resetAt: string | null }> {
    if (inTrial) return { blocked: false, resetAt: null }

    const [freeUsed, paidUsed] = await Promise.all([
      this.redis.get(todayKey(userId)).then(v => Number(v) || 0),
      this.redis.get(monthKey(userId)).then(v => Number(v) || 0),
    ])
    const blocked = plan.dailyFreeTokens - freeUsed <= 0 && plan.monthlyTotalTokens - paidUsed <= 0
    return { blocked, resetAt: blocked ? nextIranMidnightISO() : null }
  }

  async increment(userId: string, tokens: number, source: 'free' | 'paid') {
    const rKey = reqKey(userId)

    if (source === 'free') {
      const fKey = todayKey(userId)
      await Promise.all([
        this.redis.incrby(fKey, tokens),
        this.redis.expire(fKey, 90_000, 'NX'),
        this.redis.incr(rKey),
        this.redis.expire(rKey, 90_000, 'NX'),
      ])
    } else {
      const mKey = monthKey(userId)
      const dpKey = dailyPaidKey(userId)
      await Promise.all([
        this.redis.incrby(mKey, tokens),
        this.redis.expire(mKey, 2_764_800, 'NX'),
        this.redis.incrby(dpKey, tokens),
        this.redis.expire(dpKey, 90_000, 'NX'),
        this.redis.incr(rKey),
        this.redis.expire(rKey, 90_000, 'NX'),
      ])
    }
  }

  async getTodayRequestCount(userId: string): Promise<number> {
    return this.redis.get(reqKey(userId)).then(v => Number(v) || 0)
  }

  // دوره‌ی آزمایشی کاربر تازه (docs/PRD-growth-traction-features.md بخش ۳) — یک‌جا هم برای
  // چک مسدودسازی واقعی (chat.service) و هم نمایش بنر محدودیت (usage.controller) استفاده می‌شود؛
  // قبلاً هرکدام نسخه‌ی خودشون از این منطق رو داشتن و از هم عقب افتادن (بنر با کد ارسال هم‌خوان نبود).
  async getEffectiveLimits(userId: string, plan: PlanLimits): Promise<{
    inTrial: boolean
    lifetimeMessageCount: number
    effectiveN: number | null
    effectiveM: number | null
    effectiveRollingLimit: number | null
    effectiveRollingHours: number
  }> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lifetimeMessageCount: true },
    })
    const lifetimeMessageCount = dbUser?.lifetimeMessageCount ?? 0
    const inTrial = plan.trialMessageThreshold !== null && lifetimeMessageCount < plan.trialMessageThreshold

    return {
      inTrial,
      lifetimeMessageCount,
      effectiveN: inTrial ? plan.trialDailyMessageLimit ?? null : plan.dailyMessageLimit,
      effectiveM: inTrial ? plan.trialThrottledMessageCount ?? null : plan.throttledMessageCount,
      effectiveRollingLimit: inTrial ? plan.trialRollingWindowLimit ?? null : plan.rollingWindowLimit,
      effectiveRollingHours: inTrial
        ? plan.trialRollingWindowHours ?? plan.rollingWindowHours
        : plan.rollingWindowHours,
    }
  }

  // پنجره‌ی لغزان (rolling window) — یک‌جا هم برای چک مسدودسازی (chat.service) و هم
  // نمایش پیش‌گیرانه‌ی وضعیت (usage.controller) استفاده می‌شود تا منطق دوجا تکرار نشود.
  async getRollingWindowStatus(
    userId: string,
    plan: Pick<PlanLimits, 'rollingWindowLimit' | 'rollingWindowHours'>,
  ): Promise<{ blocked: boolean; resetAt: string | null }> {
    if (plan.rollingWindowLimit === null) return { blocked: false, resetAt: null }

    const key = rollingWindowKey(userId)
    const windowMs = plan.rollingWindowHours * 3_600_000
    await this.redis.zremrangebyscore(key, 0, Date.now() - windowMs)
    const countInWindow = await this.redis.zcard(key)
    if (countInWindow < plan.rollingWindowLimit) return { blocked: false, resetAt: null }

    const oldest = await this.redis.zrange(key, 0, 0, 'WITHSCORES')
    const resetAt = oldest.length >= 2 ? new Date(Number(oldest[1]) + windowMs).toISOString() : null
    return { blocked: true, resetAt }
  }

  // resolve maxOutputTokens based on today's message count and plan throttle steps
  // env overrides DB; steps must be sorted ascending by afterMessages
  resolveOutputThrottle(steps: ThrottleStep[], todayCount: number): number {
    if (!steps.length) return 4096
    let limit = 4096
    for (const step of steps) {
      if (todayCount >= step.afterMessages) limit = step.maxOutputTokens
      else break
    }
    return limit
  }

  // resolve maxInputTokens: env wins over DB plan value
  resolveInputLimit(plan: PlanLimits): number {
    const envKey = TIER_INPUT_LIMITS[plan.planTier]
    if (envKey) {
      const envVal = this.config.get<string>(envKey)
      if (envVal) return Number(envVal)
    }
    return plan.maxInputTokens
  }

  async getUsageToday(userId: string) {
    const plan = await this.getCachedPlan(userId)
    const [freeUsed, paidUsed] = await Promise.all([
      this.redis.get(todayKey(userId)).then(v => Number(v) || 0),
      this.redis.get(monthKey(userId)).then(v => Number(v) || 0),
    ])
    return {
      freeUsed,
      freeLimit: plan.dailyFreeTokens,
      paidUsed,
      paidLimit: plan.monthlyTotalTokens,
    }
  }

  async getUsageHistory(userId: string, month?: string) {
    const target = month ?? new Date().toISOString().slice(0, 7)
    const [year, mon] = target.split('-').map(Number)
    const start = new Date(year, mon - 1, 1)
    const end = new Date(year, mon, 1)

    const records = await this.prisma.dailyUsage.findMany({
      where: { userId, date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
      select: { date: true, freeTokensUsed: true, paidTokensUsed: true, requestsCount: true, costToman: true },
    })

    return records.map(r => ({
      date: r.date.toISOString().slice(0, 10),
      freeTokensUsed: r.freeTokensUsed,
      paidTokensUsed: r.paidTokensUsed,
      requestsCount: r.requestsCount,
      costToman: r.costToman,
    }))
  }

  async invalidatePlanCache(userId: string) {
    await this.redis.del(planCacheKey(userId))
  }

  async getCachedPlan(userId: string): Promise<PlanLimits> {
    const cached = await this.redis.get(planCacheKey(userId))
    if (cached) return JSON.parse(cached) as PlanLimits

    const sub = await this.prisma.subscription.findUnique({
      where: { userId },
      include: { plan: true },
    })

    let limits: PlanLimits

    if (sub?.plan) {
      const tier = this.detectTier(sub.plan.name, sub.plan.priceMonthly)
      limits = {
        planId: sub.plan.id,
        dailyFreeTokens: sub.plan.dailyFreeTokens,
        monthlyTotalTokens: sub.plan.monthlyTotalTokens,
        allowedModels: sub.plan.allowedModels as string[],
        maxInputTokens: sub.plan.maxInputTokens,
        outputThrottleSteps: (sub.plan.outputThrottleSteps as unknown as ThrottleStep[]) ?? [],
        priceMonthly: sub.plan.priceMonthly,
        planTier: tier,
        planName: sub.plan.name,
        simpleModel: sub.plan.simpleModel ?? null,
        dailyMessageLimit: sub.plan.dailyMessageLimit ?? null,
        throttledMessageCount: sub.plan.throttledMessageCount ?? null,
        throttledInputTokens: sub.plan.throttledInputTokens ?? null,
        throttledOutputTokens: sub.plan.throttledOutputTokens ?? null,
        rollingWindowLimit: sub.plan.rollingWindowLimit ?? null,
        rollingWindowHours: sub.plan.rollingWindowHours,
        contextMd: sub.plan.contextMd ?? null,
        trialMessageThreshold: sub.plan.trialMessageThreshold ?? null,
        trialDailyMessageLimit: sub.plan.trialDailyMessageLimit ?? null,
        trialThrottledMessageCount: sub.plan.trialThrottledMessageCount ?? null,
        trialRollingWindowLimit: sub.plan.trialRollingWindowLimit ?? null,
        trialRollingWindowHours: sub.plan.trialRollingWindowHours ?? null,
      }
    } else {
      // no subscription → look up the active free plan from DB instead of hardcoded defaults
      const freePlan = await this.prisma.plan.findFirst({
        where: { priceMonthly: 0, isActive: true },
        orderBy: { sortOrder: 'asc' },
      })
      limits = {
        planId: freePlan?.id ?? null,
        dailyFreeTokens: freePlan?.dailyFreeTokens ?? 5000,
        monthlyTotalTokens: freePlan?.monthlyTotalTokens ?? 0,
        allowedModels: freePlan ? (freePlan.allowedModels as string[]) : ['openai/gpt-4o-mini'],
        maxInputTokens: freePlan?.maxInputTokens ?? Number(this.config.get('MAX_INPUT_TOKENS_FREE', '300')),
        outputThrottleSteps: freePlan ? ((freePlan.outputThrottleSteps as unknown as ThrottleStep[]) ?? []) : [],
        priceMonthly: 0,
        planTier: 'free',
        planName: freePlan?.name ?? 'Free',
        simpleModel: freePlan?.simpleModel ?? null,
        dailyMessageLimit: freePlan?.dailyMessageLimit ?? null,
        throttledMessageCount: freePlan?.throttledMessageCount ?? null,
        throttledInputTokens: freePlan?.throttledInputTokens ?? null,
        throttledOutputTokens: freePlan?.throttledOutputTokens ?? null,
        rollingWindowLimit: freePlan?.rollingWindowLimit ?? null,
        rollingWindowHours: freePlan?.rollingWindowHours ?? 3,
        contextMd: freePlan?.contextMd ?? null,
        trialMessageThreshold: freePlan?.trialMessageThreshold ?? null,
        trialDailyMessageLimit: freePlan?.trialDailyMessageLimit ?? null,
        trialThrottledMessageCount: freePlan?.trialThrottledMessageCount ?? null,
        trialRollingWindowLimit: freePlan?.trialRollingWindowLimit ?? null,
        trialRollingWindowHours: freePlan?.trialRollingWindowHours ?? null,
      }
    }

    await this.redis.set(planCacheKey(userId), JSON.stringify(limits), 'EX', 3600)
    return limits
  }

  private detectTier(planName: string, price: number): string {
    const lower = planName.toLowerCase()
    if (lower.includes('premium') || lower.includes('ویژه')) return 'premium'
    if (lower.includes('pro') || lower.includes('حرفه')) return 'pro'
    if (price === 0) return 'free'
    return 'pro'
  }
}
