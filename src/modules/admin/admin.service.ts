import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import * as XLSX from 'xlsx'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
import { ExchangeRateService } from '../../exchange-rate/exchange-rate.service'
import { PricingService } from '../usage/pricing.service'
import { UsageAnalyticsService } from '../usage-analytics/usage-analytics.service'
import { fa } from '../../i18n/fa'
import { CreateModelDto, MODEL_TIERS, TOKENIZER_FAMILIES } from './dto/create-model.dto'
import { UpdateModelDto } from './dto/update-model.dto'

const MODEL_IMPORT_COLUMNS = [
  'name',
  'displayName',
  'provider',
  'inputPricePerM',
  'outputPricePerM',
  'supportsVision',
  'isActive',
  'sortOrder',
  'tier',
  'tokenizerFamily',
  'avgCharsPerToken',
] as const

function cellToString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return String(value).trim()
}

function cellToNumber(value: unknown): number | undefined {
  const s = cellToString(value)
  if (s === undefined) return undefined
  const n = Number(s)
  return Number.isNaN(n) ? undefined : n
}

function cellToBoolean(value: unknown, fallback: boolean): boolean {
  const s = cellToString(value)?.toLowerCase()
  if (s === undefined) return fallback
  if (['true', '1', 'yes', 'بله', 'فعال'].includes(s)) return true
  if (['false', '0', 'no', 'خیر', 'غیرفعال'].includes(s)) return false
  return fallback
}

function parseModelRow(raw: Record<string, unknown>) {
  return {
    name: cellToString(raw.name),
    displayName: cellToString(raw.displayName),
    provider: cellToString(raw.provider),
    inputPricePerM: cellToNumber(raw.inputPricePerM),
    outputPricePerM: cellToNumber(raw.outputPricePerM),
    supportsVision: cellToBoolean(raw.supportsVision, false),
    isActive: cellToBoolean(raw.isActive, true),
    sortOrder: cellToNumber(raw.sortOrder) ?? 0,
    tier: (cellToString(raw.tier)?.toUpperCase() as (typeof MODEL_TIERS)[number] | undefined) ?? undefined,
    tokenizerFamily: cellToString(raw.tokenizerFamily) as (typeof TOKENIZER_FAMILIES)[number] | undefined,
    avgCharsPerToken: cellToNumber(raw.avgCharsPerToken),
  }
}

type LimitType = 'daily' | '1h' | '3h' | '6h'

const LIMIT_TTL: Record<LimitType, number> = {
  '1h':    3_600,
  '3h':   10_800,
  '6h':   21_600,
  daily:  86_400,
}

function manualLimitKey(userId: string) { return `manual_limit:${userId}` }

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name)
  private readonly aiShare: number

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly exchangeRate: ExchangeRateService,
    private readonly pricingService: PricingService,
    private readonly usageAnalytics: UsageAnalyticsService,
  ) {
    // همون درصدی که PricingService برای بودجه‌ی واقعی مصرف می‌کند — برای اینکه
    // «انتظار مصرف» ادمین با محدودیت واقعی چت هماهنگ بماند، نه یک 0.7 هاردکد جدا
    this.aiShare = Number(this.config.get('AI_BUDGET_SHARE', '0.70'))
  }

  async getDashboard() {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const [
      totalUsers,
      activeUsers,
      revenueAll,
      revenueMrr,
      totalConversations,
      todayConversations,
      exchangeRate,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({
        where: { conversations: { some: { lastMessageAt: { gte: thirtyDaysAgo } } } },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.conversation.count(),
      this.prisma.conversation.count({ where: { createdAt: { gte: startOfToday } } }),
      this.exchangeRate.getRateInfo(),
    ])

    return {
      totalUsers,
      activeUsers,
      totalRevenue: revenueAll._sum.amount ?? 0,
      mrr: revenueMrr._sum.amount ?? 0,
      totalConversations,
      todayConversations,
      exchangeRate,
    }
  }

  async getUsers(page: number, limit: number, search?: string) {
    const skip = (page - 1) * limit
    const where = search ? { phone: { contains: search } } : {}

    const now = new Date()
    // «شارژ ماه» (chargedThisMonth) عمداً تقویمی می‌ماند — یک گزارش مالی «این ماه چقدر واریزی
    // داشتیم» است، نه معیار pacing per-user. برای expectedByNow/aiCostThisMonth اما، چون
    // با هم مقایسه می‌شوند، هر دو باید یک پنجره‌ی مشترک داشته باشند: دوره‌ی جاری اشتراک همون
    // کاربر (periodStart) اگر مشترک باشد، وگرنه (کاربر رایگان، بدون periodStart) همون قرارداد
    // قبلی یعنی اول ماه میلادی.
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

    const [users, total, monthlyRevenue, imageModelNames] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phone: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          subscription: {
            select: {
              status: true,
              periodEnd: true,
              periodStart: true,
              plan: { select: { name: true, priceMonthly: true } },
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
      this.prisma.payment.groupBy({
        by: ['userId'],
        where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.usageAnalytics.getImageModelNames(),
    ])

    const revenueMap = new Map(monthlyRevenue.map(r => [r.userId, r._sum.amount ?? 0]))

    // پنجره‌ی مصرف هر کاربر می‌تواند متفاوت باشد (هرکس periodStart خودش را دارد)، پس دیگر
    // نمی‌شود یک groupBy مشترک زد — قدیمی‌ترین شروع‌پنجره‌ی بین کاربرهای همین صفحه را پیدا
    // می‌کنیم، ردیف‌های خام را از آنجا می‌گیریم، و بعد به‌ازای هر کاربر خودمان جمع می‌زنیم.
    const windowStartFor = (u: (typeof users)[number]) =>
      u.subscription ? startOfDay(u.subscription.periodStart) : startOfMonth
    const earliestWindowStart = users.reduce(
      (min, u) => { const s = windowStartFor(u); return s < min ? s : min },
      startOfMonth,
    )

    const userIds = users.map(u => u.id)
    const [usageRows, messageRows] = await Promise.all([
      this.prisma.dailyUsage.findMany({
        where: { userId: { in: userIds }, date: { gte: earliestWindowStart } },
        select: { userId: true, date: true, costToman: true, costUsdMicros: true },
      }),
      // برای تفکیک مصرف متن/عکس نیاز به سطح پیام داریم — DailyUsage این تفکیک را
      // نگه نمی‌دارد (فقط جمع کل روزانه)
      this.prisma.message.findMany({
        where: {
          userId: { in: userIds }, role: 'ASSISTANT', model: { not: null },
          createdAt: { gte: earliestWindowStart },
        },
        select: { userId: true, model: true, costToman: true, costUsdMicros: true, createdAt: true },
      }),
    ])

    const enriched = users.map(u => {
      const windowStart = windowStartFor(u)
      const rowsForUser = usageRows.filter(r => r.userId === u.id && r.date >= windowStart)
      const aiCost = rowsForUser.reduce((sum, r) => sum + r.costToman, 0)
      const aiCostUsd = rowsForUser.reduce((sum, r) => sum + r.costUsdMicros, 0) / 1_000_000
      const charged = revenueMap.get(u.id) ?? 0

      const msgRowsForUser = messageRows.filter(r => r.userId === u.id && r.createdAt >= windowStart)
      const textRows = msgRowsForUser.filter(r => !imageModelNames.has(r.model as string))
      const imageRows = msgRowsForUser.filter(r => imageModelNames.has(r.model as string))
      const aiCostTextThisMonth = textRows.reduce((sum, r) => sum + r.costToman, 0)
      const aiCostImageThisMonth = imageRows.reduce((sum, r) => sum + r.costToman, 0)
      const aiCostTextUsdThisMonth = textRows.reduce((sum, r) => sum + r.costUsdMicros, 0) / 1_000_000
      const aiCostImageUsdThisMonth = imageRows.reduce((sum, r) => sum + r.costUsdMicros, 0) / 1_000_000

      const priceMonthly = u.subscription?.plan.priceMonthly ?? 0
      const monthlyBudget = Math.floor(priceMonthly * this.aiShare)

      let daysInPeriod: number
      let daysPassed: number
      if (u.subscription) {
        const { periodStart, periodEnd } = u.subscription
        daysInPeriod = Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000))
        const rawDaysPassed = Math.floor((now.getTime() - periodStart.getTime()) / 86_400_000) + 1
        daysPassed = Math.min(Math.max(rawDaysPassed, 1), daysInPeriod)
      } else {
        // کاربر رایگان — بدون دوره‌ی اشتراک؛ چون priceMonthly=۰ است budget عملاً صفر می‌شود،
        // اما برای پایداری فرمول همون قرارداد قبلی (ماه میلادی) را نگه می‌داریم
        daysInPeriod = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        daysPassed = now.getDate()
      }

      const expectedByNow = Math.floor((monthlyBudget * daysPassed) / daysInPeriod)
      const ratio = expectedByNow > 0 ? aiCost / expectedByNow : 0

      let category: 'heavy' | 'moderate' | 'light' | 'inactive' = 'inactive'
      if (aiCost > 0) {
        if (ratio >= 1.5) category = 'heavy'
        else if (ratio >= 0.5) category = 'moderate'
        else category = 'light'
      }

      this.logger.log(
        `[expectedByNow] user=${u.phone} plan=${u.subscription?.plan.name ?? 'بدون اشتراک'} `
        + `periodStart=${u.subscription?.periodStart.toISOString() ?? '- (رایگان، اول ماه میلادی)'} `
        + `periodEnd=${u.subscription?.periodEnd.toISOString() ?? '-'} daysInPeriod=${daysInPeriod} daysPassed=${daysPassed} `
        + `priceMonthly=${priceMonthly} monthlyBudget=floor(${priceMonthly} × ${this.aiShare})=${monthlyBudget} `
        + `expectedByNow=floor(${monthlyBudget} × ${daysPassed} / ${daysInPeriod})=${expectedByNow} `
        + `aiCostThisPeriod=${aiCost} (پنجره از ${windowStart.toISOString()} تا الان) ratio=${ratio.toFixed(3)} category=${category}`,
      )

      return {
        ...u,
        chargedThisMonth: charged,
        aiCostThisMonth: aiCost,
        aiCostUsdThisMonth: aiCostUsd,
        aiCostTextThisMonth,
        aiCostImageThisMonth,
        aiCostTextUsdThisMonth,
        aiCostImageUsdThisMonth,
        expectedByNow,
        category,
      }
    })

    return { users: enriched, total, page, limit }
  }

  // docs/PRD-pay-as-you-go-wallet.md بخش ۵.۵ — اولین drill-down واقعی این صفحه؛ قبلاً فقط
  // جدول تخت بود، wallet هم اصلاً select نمی‌شد
  async getUserDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lifetimeMessageCount: true,
        subscription: {
          select: { status: true, periodStart: true, periodEnd: true, plan: true },
        },
        wallet: { select: { id: true, balanceToman: true } },
      },
    })
    if (!user) throw new NotFoundException(fa.users.notFound)

    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 29 * 86_400_000)

    const [walletTransactions, payments, dailyUsage, modelBreakdown] = await Promise.all([
      user.wallet
        ? this.prisma.walletTransaction.findMany({
            where: { walletId: user.wallet.id },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : [],
      this.prisma.payment.findMany({
        where: { userId },
        include: { plan: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.dailyUsage.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
        take: 30,
      }),
      // تفکیک مصرف متن/عکس ۳۰ روز اخیر — همون منطق modelType که در صفحه‌ی
      // «آنالیز مصرف» استفاده می‌شود، اینجا برای یک کاربر خاص
      this.usageAnalytics.getModelBreakdown({ from: thirtyDaysAgo, to: now }, userId),
    ])

    const sumTypeUsage = (rows: typeof modelBreakdown) => ({
      messages: rows.reduce((s, r) => s + r.messages, 0),
      tokensInput: rows.reduce((s, r) => s + r.tokensInput, 0),
      tokensOutput: rows.reduce((s, r) => s + r.tokensOutput, 0),
      costToman: rows.reduce((s, r) => s + r.costToman, 0),
      costUsd: rows.reduce((s, r) => s + r.costUsd, 0),
      // modelBreakdown از قبل بر اساس costToman نزولی مرتب است
      mostUsedModel: rows[0]?.model ?? null,
    })

    return {
      user,
      walletBalanceToman: user.wallet?.balanceToman ?? 0,
      walletTransactions,
      payments,
      dailyUsage,
      textUsage: sumTypeUsage(modelBreakdown.filter(m => m.modelType === 'TEXT')),
      imageUsage: sumTypeUsage(modelBreakdown.filter(m => m.modelType === 'IMAGE')),
    }
  }

  async updateUser(userId: string, data: { isActive?: boolean; role?: 'USER' | 'ADMIN' }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException(fa.admin.userNotFound)

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, phone: true, name: true, role: true, isActive: true },
    })

    return { message: fa.admin.userUpdated, user: updated }
  }

  async getTokenStats() {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [todayStats, monthStats] = await Promise.all([
      this.prisma.dailyUsage.aggregate({
        where: { date: { gte: startOfToday } },
        _sum: { freeTokensUsed: true, paidTokensUsed: true, requestsCount: true },
      }),
      this.prisma.dailyUsage.aggregate({
        where: { date: { gte: startOfMonth } },
        _sum: { freeTokensUsed: true, paidTokensUsed: true },
      }),
    ])

    return {
      today: {
        totalFree: todayStats._sum.freeTokensUsed ?? 0,
        totalPaid: todayStats._sum.paidTokensUsed ?? 0,
        requests: todayStats._sum.requestsCount ?? 0,
      },
      thisMonth: {
        totalFree: monthStats._sum.freeTokensUsed ?? 0,
        totalPaid: monthStats._sum.paidTokensUsed ?? 0,
      },
    }
  }

  async getCostChart(days = 30) {
    const since = new Date()
    since.setDate(since.getDate() - days)
    since.setHours(0, 0, 0, 0)

    const [costRows, revenueRows, liaraRows] = await Promise.all([
      this.prisma.dailyUsage.groupBy({
        by: ['date'],
        where: { date: { gte: since } },
        _sum: { costToman: true, costUsdMicros: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; revenue: bigint }>>`
        SELECT DATE_TRUNC('day', "createdAt") AS day, SUM(amount)::bigint AS revenue
        FROM payments
        WHERE status = 'COMPLETED' AND "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY day ASC
      `,
      this.prisma.liaraUsageSnapshot.groupBy({
        by: ['date'],
        where: { date: { gte: since } },
        _sum: { realCostToman: true },
        orderBy: { date: 'asc' },
      }),
    ])

    const revenueMap = new Map(
      revenueRows.map(r => [r.day.toISOString().slice(0, 10), Number(r.revenue)]),
    )
    // نبود رکورد یعنی هنوز کلید اختصاصی لیارا برای هیچ کاربری فعال نبوده — null نه صفر
    const liaraMap = new Map(
      liaraRows.map(r => [r.date.toISOString().slice(0, 10), r._sum.realCostToman ?? 0]),
    )

    return costRows.map(r => {
      const date = r.date.toISOString().slice(0, 10)
      return {
        date,
        aiCostToman: r._sum.costToman ?? 0,
        aiCostUsd: (r._sum.costUsdMicros ?? 0) / 1_000_000,
        revenueToman: revenueMap.get(date) ?? 0,
        liaraCostToman: liaraMap.get(date) ?? null,
      }
    })
  }

  async getPricingAlert() {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [revenueRow, costRow] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      this.prisma.dailyUsage.aggregate({
        where: { date: { gte: startOfMonth } },
        _sum: { costToman: true, costUsdMicros: true },
      }),
    ])

    const monthlyRevenue = revenueRow._sum.amount ?? 0
    const monthlyAiCost = costRow._sum.costToman ?? 0
    const monthlyAiCostUsd = (costRow._sum.costUsdMicros ?? 0) / 1_000_000
    const ratio = monthlyRevenue > 0 ? monthlyAiCost / monthlyRevenue : 0

    let alertLevel: 'safe' | 'warning' | 'critical' = 'safe'
    let suggestion: string | null = null

    if (ratio >= 0.75) {
      alertLevel = 'critical'
      const targetRatio = 0.55 // aim to bring cost down to 55% of revenue
      const suggestedMultiplier = ratio / targetRatio
      suggestion = [
        `هزینه AI این ماه ${(ratio * 100).toFixed(1)}٪ درآمد است (آستانه: ۷۵٪).`,
        `برای رسیدن به نسبت سالم ۵۵٪، پیشنهاد می‌شود قیمت پلن‌ها را حدود ${((suggestedMultiplier - 1) * 100).toFixed(0)}٪ افزایش دهید.`,
      ].join(' ')
    } else if (ratio >= 0.60) {
      alertLevel = 'warning'
      suggestion = `هزینه AI این ماه ${(ratio * 100).toFixed(1)}٪ درآمد است — نزدیک به آستانه هشدار. مراقب باشید.`
    }

    return {
      monthlyRevenueToman: monthlyRevenue,
      monthlyAiCostToman: monthlyAiCost,
      monthlyAiCostUsd,
      aiCostRatio: Math.round(ratio * 1000) / 10,
      alertLevel,
      suggestion,
    }
  }

  async setManualLimit(userId: string, type: LimitType, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException(fa.admin.userNotFound)

    const ttl = LIMIT_TTL[type]
    const expiresAt = Date.now() + ttl * 1000
    await this.redis.set(
      manualLimitKey(userId),
      JSON.stringify({ type, reason: reason ?? '', expiresAt }),
      'EX',
      ttl,
    )
    return { success: true, expiresAt: new Date(expiresAt).toISOString() }
  }

  async removeManualLimit(userId: string) {
    await this.redis.del(manualLimitKey(userId))
    return { success: true }
  }

  async getManualLimit(userId: string) {
    const raw = await this.redis.get(manualLimitKey(userId))
    if (!raw) return null
    return JSON.parse(raw) as { type: LimitType; reason: string; expiresAt: number }
  }

  async changeUserPlan(userId: string, planId: string) {
    const [user, plan] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.plan.findUnique({ where: { id: planId } }),
    ])
    if (!user) throw new NotFoundException(fa.admin.userNotFound)
    if (!plan) throw new NotFoundException(fa.plans.notFound)

    const now = new Date()
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate())

    const sub = await this.prisma.subscription.upsert({
      where: { userId },
      create: { userId, planId, periodStart: now, periodEnd, status: 'ACTIVE' },
      update: { planId, periodStart: now, periodEnd, status: 'ACTIVE', cancelAtPeriodEnd: false },
    })

    // clear plan cache so next request fetches new plan
    await this.redis.del(`plan:${userId}`)

    return { success: true, subscription: sub }
  }

  // docs/PRD-pay-as-you-go-wallet.md — بازگشت وجه دستی (پول واقعی را خودِ ادمین خارج از این
  // سیستم برمی‌گرداند): موجودی کیف‌پول صفر و به‌عنوان تراکنش ثبت می‌شود، و کاربر از پلن PAYG
  // خارج و به پلن رایگان سوییچ می‌شود — مبلغ دقیق برگردانده‌شده برای انجام واقعی به ادمین نشان داده می‌شود
  async refundAndDeactivatePayg(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException(fa.admin.userNotFound)

    const refundedAmountToman = await this.pricingService.refundWallet(userId, fa.payAsYouGo.adminRefundDescription)

    const freePlan = await this.prisma.plan.findFirst({
      where: { priceMonthly: 0, isActive: true },
      orderBy: { sortOrder: 'asc' },
    })
    if (freePlan) await this.changeUserPlan(userId, freePlan.id)

    return { refundedAmountToman, downgradedToFreePlan: Boolean(freePlan) }
  }

  async getRevenueStats() {
    const rows = await this.prisma.$queryRaw<Array<{ month: string; revenue: bigint; count: bigint }>>`
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
        SUM(amount)::bigint AS revenue,
        COUNT(*)::bigint AS count
      FROM payments
      WHERE status = 'COMPLETED'
        AND "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY DATE_TRUNC('month', "createdAt") ASC
    `

    return rows.map(r => ({
      month: r.month,
      revenue: Number(r.revenue),
      count: Number(r.count),
    }))
  }

  // ── AI Models ────────────────────────────────────────────────────────────

  getModels() {
    return this.prisma.aiModel.findMany({ orderBy: { sortOrder: 'asc' } })
  }

  createModel(dto: CreateModelDto) {
    return this.prisma.aiModel.create({ data: dto })
  }

  async updateModel(id: string, dto: UpdateModelDto) {
    const model = await this.prisma.aiModel.findUnique({ where: { id } })
    if (!model) throw new NotFoundException('مدل یافت نشد')
    return this.prisma.aiModel.update({ where: { id }, data: dto })
  }

  async deleteModel(id: string) {
    const model = await this.prisma.aiModel.findUnique({ where: { id } })
    if (!model) throw new NotFoundException('مدل یافت نشد')
    await this.prisma.aiModel.delete({ where: { id } })
    return { message: 'مدل حذف شد' }
  }

  async importModels(buffer: Buffer) {
    let workbook: XLSX.WorkBook
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' })
    } catch {
      throw new BadRequestException('فایل اکسل قابل خواندن نیست')
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    if (rows.length === 0) throw new BadRequestException('فایل اکسل خالی است')

    const hasKnownColumn = Object.keys(rows[0]).some(
      (key) => (MODEL_IMPORT_COLUMNS as readonly string[]).includes(key),
    )
    if (!hasKnownColumn) {
      throw new BadRequestException(
        `فرمت ستون‌های فایل اکسل شناخته نشد. ستون‌های مورد انتظار: ${MODEL_IMPORT_COLUMNS.join('، ')}`,
      )
    }

    let created = 0
    let updated = 0
    const errors: Array<{ row: number; message: string }> = []

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2 // ردیف ۱ هدر است
      const data = parseModelRow(rows[i])

      const instance = plainToInstance(CreateModelDto, data)
      const violations = await validate(instance)
      if (violations.length > 0) {
        const message = violations
          .map((v) => Object.values(v.constraints ?? {}).join('، '))
          .join(' | ')
        errors.push({ row: rowNumber, message })
        continue
      }

      try {
        const existing = await this.prisma.aiModel.findUnique({ where: { name: data.name } })
        await this.prisma.aiModel.upsert({
          where: { name: data.name as string },
          create: data as CreateModelDto,
          update: data,
        })
        if (existing) updated++
        else created++
      } catch {
        errors.push({ row: rowNumber, message: 'خطا در ذخیره‌سازی این ردیف' })
      }
    }

    return { total: rows.length, created, updated, errors }
  }
}
