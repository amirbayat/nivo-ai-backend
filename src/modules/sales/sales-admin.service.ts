import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { SalesKbKind } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { SmsService } from '../../sms/sms.service'
import { SalesConfigService, type UpdatableSalesBotConfig } from './sales-config.service'
import { SalesKbService, type SalesKbEntryInput, type SalesKbEntryUpdateInput } from './sales-kb.service'

export interface SalesBotAnalyticsOverview {
  totalMessages: number
  totalTokensInput: number
  totalTokensOutput: number
  totalTokens: number
  costToman: number
  costUsd: number
  sessionsStarted: number
  discountOffersShown: number
  phonesCaptured: number
  discountConversionRate: number | null // phonesCaptured / discountOffersShown
}

export interface SalesBotAnalyticsPoint {
  date: string
  messages: number
  tokens: number
  costToman: number
}

@Injectable()
export class SalesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesConfig: SalesConfigService,
    private readonly salesKb: SalesKbService,
    private readonly sms: SmsService,
  ) {}

  // ─── پایگاه دانش (RAG) — docs/PRD-sales-kb-rag-and-plan-context.md بخش الف.۱۰ ──
  listKbEntries(kind?: string) {
    return this.salesKb.list(kind as SalesKbKind | undefined)
  }

  createKbEntry(input: SalesKbEntryInput) {
    return this.salesKb.create(input)
  }

  updateKbEntry(id: string, input: SalesKbEntryUpdateInput) {
    return this.salesKb.update(id, input)
  }

  deleteKbEntry(id: string) {
    return this.salesKb.remove(id)
  }

  bulkImportKbEntries(entries: SalesKbEntryInput[]) {
    return this.salesKb.bulkImport(entries)
  }

  testKbRetrieval(sampleMessage: string) {
    return this.salesKb.testRetrieval(sampleMessage)
  }

  getConfig() {
    return this.salesConfig.getConfig()
  }

  updateConfig(data: UpdatableSalesBotConfig) {
    return this.salesConfig.updateConfig(data)
  }

  async getAnalyticsOverview(from: string, to: string): Promise<SalesBotAnalyticsOverview> {
    const rows = await this.prisma.salesBotDailyUsage.findMany({
      where: { date: { gte: new Date(from), lte: new Date(to) } },
    })

    const totals = rows.reduce(
      (acc, r) => ({
        totalMessages: acc.totalMessages + r.messageCount,
        totalTokensInput: acc.totalTokensInput + r.tokensInput,
        totalTokensOutput: acc.totalTokensOutput + r.tokensOutput,
        costToman: acc.costToman + r.costToman,
        costUsdMicros: acc.costUsdMicros + r.costUsdMicros,
        sessionsStarted: acc.sessionsStarted + r.sessionsStarted,
        discountOffersShown: acc.discountOffersShown + r.discountOffersShown,
        phonesCaptured: acc.phonesCaptured + r.phonesCaptured,
      }),
      {
        totalMessages: 0,
        totalTokensInput: 0,
        totalTokensOutput: 0,
        costToman: 0,
        costUsdMicros: 0,
        sessionsStarted: 0,
        discountOffersShown: 0,
        phonesCaptured: 0,
      },
    )

    return {
      totalMessages: totals.totalMessages,
      totalTokensInput: totals.totalTokensInput,
      totalTokensOutput: totals.totalTokensOutput,
      totalTokens: totals.totalTokensInput + totals.totalTokensOutput,
      costToman: totals.costToman,
      costUsd: totals.costUsdMicros / 1_000_000,
      sessionsStarted: totals.sessionsStarted,
      discountOffersShown: totals.discountOffersShown,
      phonesCaptured: totals.phonesCaptured,
      discountConversionRate: totals.discountOffersShown > 0
        ? totals.phonesCaptured / totals.discountOffersShown
        : null,
    }
  }

  async getAnalyticsTimeseries(from: string, to: string): Promise<SalesBotAnalyticsPoint[]> {
    const rows = await this.prisma.salesBotDailyUsage.findMany({
      where: { date: { gte: new Date(from), lte: new Date(to) } },
      orderBy: { date: 'asc' },
    })

    return rows.map(r => ({
      date: r.date.toISOString().slice(0, 10),
      messages: r.messageCount,
      tokens: r.tokensInput + r.tokensOutput,
      costToman: r.costToman,
    }))
  }

  async getLeads(page: number, limit: number, followUpStatus?: string) {
    const where = followUpStatus ? { followUpStatus: followUpStatus as any } : {}
    const [items, total] = await Promise.all([
      this.prisma.leadProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.leadProfile.count({ where }),
    ])
    return { items, total, page, limit }
  }

  async updateLeadFollowUp(id: string, followUpStatus: string) {
    const lead = await this.prisma.leadProfile.findUnique({ where: { id } })
    if (!lead) throw new NotFoundException('لید پیدا نشد')

    return this.prisma.leadProfile.update({
      where: { id },
      data: { followUpStatus: followUpStatus as any },
    })
  }

  async sendLeadSms(id: string, message: string) {
    const lead = await this.prisma.leadProfile.findUnique({ where: { id } })
    if (!lead) throw new NotFoundException('لید پیدا نشد')
    if (!lead.phone) throw new BadRequestException('این لید شماره موبایل ندارد')

    await this.sms.sendFreeText(lead.phone, message)

    return this.prisma.leadProfile.update({
      where: { id },
      data: { followUpStatus: lead.followUpStatus === 'NEW' ? 'CONTACTED' : lead.followUpStatus },
    })
  }
}
