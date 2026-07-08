import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import * as XLSX from 'xlsx'
import { PrismaService } from '../../prisma/prisma.service'
import { RedisService } from '../../redis/redis.service'
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

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
    ])

    return {
      totalUsers,
      activeUsers,
      totalRevenue: revenueAll._sum.amount ?? 0,
      mrr: revenueMrr._sum.amount ?? 0,
      totalConversations,
      todayConversations,
    }
  }

  async getUsers(page: number, limit: number, search?: string) {
    const skip = (page - 1) * limit
    const where = search ? { phone: { contains: search } } : {}

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const daysPassed = now.getDate()

    const [users, total, monthlyRevenue, monthlyCost] = await Promise.all([
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
      this.prisma.dailyUsage.groupBy({
        by: ['userId'],
        where: { date: { gte: startOfMonth } },
        _sum: { costRial: true, costUsdMicros: true },
      }),
    ])

    const revenueMap = new Map(monthlyRevenue.map(r => [r.userId, r._sum.amount ?? 0]))
    const costMap = new Map(monthlyCost.map(r => [r.userId, r._sum.costRial ?? 0]))
    const costUsdMap = new Map(monthlyCost.map(r => [r.userId, r._sum.costUsdMicros ?? 0]))

    const enriched = users.map(u => {
      const charged = revenueMap.get(u.id) ?? 0
      const aiCost = costMap.get(u.id) ?? 0
      const aiCostUsd = (costUsdMap.get(u.id) ?? 0) / 1_000_000
      const monthlyBudget = Math.floor((u.subscription?.plan.priceMonthly ?? 0) * 0.7)
      const expectedByNow = Math.floor((monthlyBudget * daysPassed) / daysInMonth)
      const ratio = expectedByNow > 0 ? aiCost / expectedByNow : 0

      let category: 'heavy' | 'moderate' | 'light' | 'inactive' = 'inactive'
      if (aiCost > 0) {
        if (ratio >= 1.5) category = 'heavy'
        else if (ratio >= 0.5) category = 'moderate'
        else category = 'light'
      }

      return { ...u, chargedThisMonth: charged, aiCostThisMonth: aiCost, aiCostUsdThisMonth: aiCostUsd, expectedByNow, category }
    })

    return { users: enriched, total, page, limit }
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

    const [costRows, revenueRows] = await Promise.all([
      this.prisma.dailyUsage.groupBy({
        by: ['date'],
        where: { date: { gte: since } },
        _sum: { costRial: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.$queryRaw<Array<{ day: Date; revenue: bigint }>>`
        SELECT DATE_TRUNC('day', "createdAt") AS day, SUM(amount)::bigint AS revenue
        FROM payments
        WHERE status = 'COMPLETED' AND "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY day ASC
      `,
    ])

    const revenueMap = new Map(
      revenueRows.map(r => [r.day.toISOString().slice(0, 10), Number(r.revenue)]),
    )

    return costRows.map(r => ({
      date: r.date.toISOString().slice(0, 10),
      aiCostRial: r._sum.costRial ?? 0,
      revenueToman: revenueMap.get(r.date.toISOString().slice(0, 10)) ?? 0,
    }))
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
        _sum: { costRial: true },
      }),
    ])

    const monthlyRevenue = revenueRow._sum.amount ?? 0
    const monthlyAiCost = costRow._sum.costRial ?? 0
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
      monthlyAiCostRial: monthlyAiCost,
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
