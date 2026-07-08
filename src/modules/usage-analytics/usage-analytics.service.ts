import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import type { LimitHitType, UserSegment } from '@prisma/client'

export interface DateRange {
  from: Date
  to: Date
}

export function parseDateRange(from?: string, to?: string): DateRange {
  const toDate = to ? new Date(to) : new Date()
  const fromDate = from
    ? new Date(from)
    : new Date(toDate.getTime() - 29 * 86_400_000) // پیش‌فرض: ۳۰ روز اخیر
  // انتهای بازه را تا آخر همان روز می‌کشیم تا رکوردهای همان روز جا نمانند
  toDate.setHours(23, 59, 59, 999)
  return { from: fromDate, to: toDate }
}

function previousPeriod(range: DateRange): DateRange {
  const lengthMs = range.to.getTime() - range.from.getTime()
  return {
    from: new Date(range.from.getTime() - lengthMs - 1),
    to: new Date(range.from.getTime() - 1),
  }
}

function daysBetweenInclusive(from: Date, to: Date): number {
  return Math.max(1, Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1)
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / previous
}

function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0
  const idx = (p / 100) * (sortedAsc.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export interface UserUsageRow {
  userId: string
  phone: string | null
  name: string | null
  messages: number
  avgMessagesPerDay: number
  tokensInput: number
  tokensOutput: number
  avgTokensPerDay: number
  costRial: number
  costUsd: number
  revenueRial: number
  marginRial: number
  mostUsedModel: string | null
  segment: string | null
}

/**
 * کوئری‌های تجمیعی برای آنالیز مصرف/هزینه/بخش‌بندی کاربران — بازه‌ی تاریخ
 * دلخواه، نه فقط «امروز»/«این ماه» (docs/PRD-global-budget-gateway.md بخش ۱۷).
 * این سرویس گزارش‌گیری محض است؛ هیچ درخواست کاربری را رد یا محدود نمی‌کند.
 */
@Injectable()
export class UsageAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(range: DateRange, compare: boolean) {
    const current = await this.computeOverview(range)
    if (!compare) return { current, previous: null }

    const previous = await this.computeOverview(previousPeriod(range))
    return {
      current,
      previous,
      growth: {
        totalTokens: pctChange(current.totalTokens, previous.totalTokens),
        totalMessages: pctChange(current.totalMessages, previous.totalMessages),
        costRial: pctChange(current.costRial, previous.costRial),
        revenueRial: pctChange(current.revenueRial, previous.revenueRial),
      },
    }
  }

  private async computeOverview(range: DateRange) {
    const [usage, revenue, modelBreakdown] = await Promise.all([
      this.prisma.dailyUsage.aggregate({
        where: { date: { gte: range.from, lte: range.to } },
        _sum: {
          freeTokensUsed: true,
          paidTokensUsed: true,
          requestsCount: true,
          costRial: true,
          costUsdMicros: true,
        },
      }),
      this.prisma.payment.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: range.from, lte: range.to } },
        _sum: { amount: true },
      }),
      this.getModelBreakdown(range),
    ])

    const totalTokens = (usage._sum.freeTokensUsed ?? 0) + (usage._sum.paidTokensUsed ?? 0)
    const totalMessages = usage._sum.requestsCount ?? 0
    const costRial = usage._sum.costRial ?? 0
    const revenueRial = revenue._sum.amount ?? 0

    // میانگین توکن ورودی/خروجی و میانگین وزنیِ قیمت هر میلیون توکن، از روی
    // model breakdown همین بازه محاسبه می‌شود — چون DailyUsage توکن ورودی/خروجی
    // را جدا نگه نمی‌دارد (فقط freeTokensUsed/paidTokensUsed کل)؛ وزن‌دهی بر اساس
    // حجم واقعی توکنی هر مدل است، نه میانگین ساده‌ی نرخ‌های استاتیک مدل‌ها
    const messagesWithModel = modelBreakdown.reduce((s, m) => s + m.messages, 0)
    const totalInputTokens = modelBreakdown.reduce((s, m) => s + m.tokensInput, 0)
    const totalOutputTokens = modelBreakdown.reduce((s, m) => s + m.tokensOutput, 0)
    const totalInputCostUsd = modelBreakdown.reduce((s, m) => s + m.costInputUsd, 0)
    const totalOutputCostUsd = modelBreakdown.reduce((s, m) => s + m.costOutputUsd, 0)

    return {
      totalTokens,
      totalMessages,
      costRial,
      costUsd: (usage._sum.costUsdMicros ?? 0) / 1_000_000,
      revenueRial,
      marginRial: revenueRial - costRial,
      marginPct: revenueRial > 0 ? (revenueRial - costRial) / revenueRial : null,
      avgTokensPerMessage: totalMessages > 0 ? Math.round(totalTokens / totalMessages) : 0,
      avgInputTokensPerMessage: messagesWithModel > 0 ? Math.round(totalInputTokens / messagesWithModel) : 0,
      avgOutputTokensPerMessage: messagesWithModel > 0 ? Math.round(totalOutputTokens / messagesWithModel) : 0,
      avgInputPricePerMillionUsd: totalInputTokens > 0 ? (totalInputCostUsd / totalInputTokens) * 1_000_000 : 0,
      avgOutputPricePerMillionUsd: totalOutputTokens > 0 ? (totalOutputCostUsd / totalOutputTokens) * 1_000_000 : 0,
      topModel: modelBreakdown[0]?.model ?? null,
    }
  }

  async getTimeseries(range: DateRange, granularity: 'day' | 'week' | 'month') {
    const rows = await this.prisma.dailyUsage.groupBy({
      by: ['date'],
      where: { date: { gte: range.from, lte: range.to } },
      _sum: {
        freeTokensUsed: true,
        paidTokensUsed: true,
        requestsCount: true,
        costRial: true,
        costUsdMicros: true,
      },
      orderBy: { date: 'asc' },
    })

    const points = rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      tokens: (r._sum.freeTokensUsed ?? 0) + (r._sum.paidTokensUsed ?? 0),
      messages: r._sum.requestsCount ?? 0,
      costRial: r._sum.costRial ?? 0,
      costUsd: (r._sum.costUsdMicros ?? 0) / 1_000_000,
    }))

    if (granularity === 'day') return points

    const buckets = new Map<
      string,
      { tokens: number; messages: number; costRial: number; costUsd: number }
    >()
    for (const p of points) {
      const key = granularity === 'month' ? p.date.slice(0, 7) : isoWeekKey(p.date)
      const b = buckets.get(key) ?? { tokens: 0, messages: 0, costRial: 0, costUsd: 0 }
      b.tokens += p.tokens
      b.messages += p.messages
      b.costRial += p.costRial
      b.costUsd += p.costUsd
      buckets.set(key, b)
    }
    return Array.from(buckets.entries())
      .map(([period, v]) => ({ period, ...v }))
      .sort((a, b) => a.period.localeCompare(b.period))
  }

  // هزینه/توکن دقیقاً از Message.costRial/costUsdMicros خوانده می‌شود — همان
  // عددی که لحظه‌ی ایجاد پیام محاسبه شده، نه بازمحاسبه با قیمت/نرخ فعلی
  async getModelBreakdown(range: DateRange) {
    const rows = await this.prisma.message.groupBy({
      by: ['model'],
      where: { role: 'ASSISTANT', model: { not: null }, createdAt: { gte: range.from, lte: range.to } },
      _sum: {
        tokensInput: true,
        tokensOutput: true,
        costRial: true,
        costUsdMicros: true,
        costInputUsdMicros: true,
        costOutputUsdMicros: true,
      },
      _count: { id: true },
    })
    return rows
      .map((r) => {
        const tokensInput = r._sum.tokensInput ?? 0
        const tokensOutput = r._sum.tokensOutput ?? 0
        const costInputUsd = (r._sum.costInputUsdMicros ?? 0) / 1_000_000
        const costOutputUsd = (r._sum.costOutputUsdMicros ?? 0) / 1_000_000
        return {
          model: r.model as string,
          messages: r._count.id,
          tokensInput,
          tokensOutput,
          costRial: r._sum.costRial ?? 0,
          costUsd: (r._sum.costUsdMicros ?? 0) / 1_000_000,
          costInputUsd,
          costOutputUsd,
          // میانگین وزنیِ قیمت هر میلیون توکن برای همین مدل در این بازه
          avgInputPricePerMillionUsd: tokensInput > 0 ? (costInputUsd / tokensInput) * 1_000_000 : 0,
          avgOutputPricePerMillionUsd: tokensOutput > 0 ? (costOutputUsd / tokensOutput) * 1_000_000 : 0,
        }
      })
      .sort((a, b) => b.costRial - a.costRial)
  }

  async getTopicBreakdown(range: DateRange) {
    const [rows, untagged, topics] = await Promise.all([
      this.prisma.message.groupBy({
        by: ['topicId'],
        where: { role: 'USER', topicId: { not: null }, createdAt: { gte: range.from, lte: range.to } },
        _count: { id: true },
      }),
      this.prisma.message.count({
        where: { role: 'USER', topicId: null, createdAt: { gte: range.from, lte: range.to } },
      }),
      this.prisma.topic.findMany({ select: { id: true, name: true, color: true } }),
    ])

    const topicMap = new Map(topics.map((t) => [t.id, t]))
    const total = rows.reduce((s, r) => s + r._count.id, 0) + untagged

    const result = rows.map((r) => {
      const topic = topicMap.get(r.topicId as string)
      return {
        topicId: r.topicId,
        name: topic?.name ?? 'نامشخص',
        color: topic?.color ?? null,
        messages: r._count.id,
        pct: total > 0 ? r._count.id / total : 0,
      }
    })
    if (untagged > 0) {
      result.push({
        topicId: null,
        name: 'نامشخص',
        color: null,
        messages: untagged,
        pct: total > 0 ? untagged / total : 0,
      })
    }
    return result.sort((a, b) => b.messages - a.messages)
  }

  async getLimitHits(range: DateRange) {
    const [byType, uniqueUsers] = await Promise.all([
      this.prisma.limitHitEvent.groupBy({
        by: ['type'],
        where: { date: { gte: range.from, lte: range.to } },
        _count: { id: true },
      }),
      this.prisma.limitHitEvent.findMany({
        where: { date: { gte: range.from, lte: range.to } },
        select: { userId: true },
        distinct: ['userId'],
      }),
    ])
    return {
      byType: byType.map((r) => ({ type: r.type, count: r._count.id })),
      uniqueUsers: uniqueUsers.length,
    }
  }

  async logLimitHit(userId: string, type: LimitHitType): Promise<void> {
    try {
      const today = new Date(new Date().toISOString().slice(0, 10))
      await this.prisma.limitHitEvent.create({ data: { userId, type, date: today } })
    } catch {
      // گزارش‌گیری است، نباید مسیر اصلی درخواست کاربر را بشکند
    }
  }

  async getUsers(range: DateRange, segmentLabel?: string): Promise<UserUsageRow[]> {
    const days = daysBetweenInclusive(range.from, range.to)

    const [perUserModel, revenueRows, segments] = await Promise.all([
      this.prisma.message.groupBy({
        by: ['userId', 'model'],
        where: { role: 'ASSISTANT', userId: { not: null }, createdAt: { gte: range.from, lte: range.to } },
        _sum: { tokensInput: true, tokensOutput: true, costRial: true, costUsdMicros: true },
        _count: { id: true },
      }),
      this.prisma.payment.groupBy({
        by: ['userId'],
        where: { status: 'COMPLETED', createdAt: { gte: range.from, lte: range.to } },
        _sum: { amount: true },
      }),
      this.listSegments(),
    ])

    interface Agg {
      messages: number
      tokensInput: number
      tokensOutput: number
      costRial: number
      costUsdMicros: number
      modelCounts: Map<string, number>
    }
    const byUser = new Map<string, Agg>()
    for (const row of perUserModel) {
      const uid = row.userId as string
      const agg = byUser.get(uid) ?? {
        messages: 0,
        tokensInput: 0,
        tokensOutput: 0,
        costRial: 0,
        costUsdMicros: 0,
        modelCounts: new Map<string, number>(),
      }
      agg.messages += row._count.id
      agg.tokensInput += row._sum.tokensInput ?? 0
      agg.tokensOutput += row._sum.tokensOutput ?? 0
      agg.costRial += row._sum.costRial ?? 0
      agg.costUsdMicros += row._sum.costUsdMicros ?? 0
      if (row.model) agg.modelCounts.set(row.model, (agg.modelCounts.get(row.model) ?? 0) + row._count.id)
      byUser.set(uid, agg)
    }

    const revenueMap = new Map(revenueRows.map((r) => [r.userId, r._sum.amount ?? 0]))
    const userIds = Array.from(byUser.keys())
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, phone: true, name: true },
        })
      : []
    const userMap = new Map(users.map((u) => [u.id, u]))

    let results: UserUsageRow[] = userIds.map((userId) => {
      const agg = byUser.get(userId)!
      const revenueRial = revenueMap.get(userId) ?? 0
      const avgMessagesPerDay = agg.messages / days
      const avgTokensPerDay = (agg.tokensInput + agg.tokensOutput) / days
      const segment = this.matchSegment(segments, avgMessagesPerDay, avgTokensPerDay)
      const mostUsedModel =
        [...agg.modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      const user = userMap.get(userId)
      return {
        userId,
        phone: user?.phone ?? null,
        name: user?.name ?? null,
        messages: agg.messages,
        avgMessagesPerDay,
        tokensInput: agg.tokensInput,
        tokensOutput: agg.tokensOutput,
        avgTokensPerDay,
        costRial: agg.costRial,
        costUsd: agg.costUsdMicros / 1_000_000,
        revenueRial,
        marginRial: revenueRial - agg.costRial,
        mostUsedModel,
        segment: segment?.label ?? null,
      }
    })

    if (segmentLabel) results = results.filter((r) => r.segment === segmentLabel)
    return results.sort((a, b) => b.costRial - a.costRial)
  }

  async exportUsersCsv(range: DateRange, segmentLabel?: string): Promise<string> {
    const users = await this.getUsers(range, segmentLabel)
    const header = [
      'شماره موبایل', 'نام', 'تعداد پیام', 'میانگین پیام روزانه',
      'توکن ورودی', 'توکن خروجی', 'هزینه (تومان)', 'هزینه (دلار)',
      'درآمد (تومان)', 'حاشیه سود (تومان)', 'پرمصرف‌ترین مدل', 'دسته',
    ]
    const lines = [header.join(',')]
    for (const u of users) {
      lines.push(
        [
          u.phone, u.name, u.messages, u.avgMessagesPerDay.toFixed(1),
          u.tokensInput, u.tokensOutput, u.costRial, u.costUsd.toFixed(4),
          u.revenueRial, u.marginRial, u.mostUsedModel, u.segment,
        ]
          .map(csvEscape)
          .join(','),
      )
    }
    return lines.join('\n')
  }

  async getSegmentBreakdown(range: DateRange, compare: boolean) {
    const current = await this.computeSegmentBreakdown(range)
    if (!compare) return { current, previous: null }
    const previous = await this.computeSegmentBreakdown(previousPeriod(range))
    return { current, previous }
  }

  private async computeSegmentBreakdown(range: DateRange) {
    const users = await this.getUsers(range)
    const groups = new Map<string, UserUsageRow[]>()
    for (const u of users) {
      const key = u.segment ?? 'بدون دسته'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(u)
    }

    return Array.from(groups.entries()).map(([label, group]) => {
      const msgValues = group.map((g) => g.avgMessagesPerDay).sort((a, b) => a - b)
      const tokenValues = group.map((g) => g.avgTokensPerDay).sort((a, b) => a - b)
      const costRial = group.reduce((s, g) => s + g.costRial, 0)
      const costUsd = group.reduce((s, g) => s + g.costUsd, 0)
      const revenueRial = group.reduce((s, g) => s + g.revenueRial, 0)
      return {
        label,
        userCount: group.length,
        avgMessagesPerDay: msgValues.reduce((s, v) => s + v, 0) / group.length,
        medianMessagesPerDay: percentile(msgValues, 50),
        p90MessagesPerDay: percentile(msgValues, 90),
        avgTokensPerDay: tokenValues.reduce((s, v) => s + v, 0) / group.length,
        medianTokensPerDay: percentile(tokenValues, 50),
        p90TokensPerDay: percentile(tokenValues, 90),
        costRial,
        costUsd,
        revenueRial,
        marginRial: revenueRial - costRial,
        marginPct: revenueRial > 0 ? (revenueRial - costRial) / revenueRial : null,
      }
    })
  }

  private matchSegment(
    segments: UserSegment[],
    avgMessagesPerDay: number,
    avgTokensPerDay: number,
  ): UserSegment | null {
    for (const s of segments) {
      if (s.minMessagesPerDay != null && avgMessagesPerDay < s.minMessagesPerDay) continue
      if (s.maxMessagesPerDay != null && avgMessagesPerDay > s.maxMessagesPerDay) continue
      if (s.minTokensPerDay != null && avgTokensPerDay < s.minTokensPerDay) continue
      if (s.maxTokensPerDay != null && avgTokensPerDay > s.maxTokensPerDay) continue
      return s
    }
    return null
  }

  // ─── Segment CRUD ──────────────────────────────────────────────────────────

  async listSegments() {
    return this.prisma.userSegment.findMany({ orderBy: { sortOrder: 'asc' } })
  }

  async createSegment(data: Omit<UserSegment, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.prisma.userSegment.create({ data })
  }

  async updateSegment(id: string, data: Partial<Omit<UserSegment, 'id'>>) {
    return this.prisma.userSegment.update({ where: { id }, data })
  }

  async deleteSegment(id: string) {
    return this.prisma.userSegment.delete({ where: { id } })
  }
}

function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)) // نزدیک‌ترین پنجشنبه (استاندارد ISO week)
  const week1 = new Date(d.getFullYear(), 0, 4)
  const weekNo =
    1 + Math.round(((d.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`
}
