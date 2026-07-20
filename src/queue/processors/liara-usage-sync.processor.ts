import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { LiaraManagementService, type LiaraLogEntry } from '../../modules/liara/liara-management.service'

// docs/PRD-liara-usage-reconciliation.md — روزی یک‌بار برای «دیروز» (تاریخ UTC)، مصرف واقعی هر
// کاربرِ دارای کلید اختصاصی را از GET /ai-logs/logs می‌کشد و در LiaraUsageSnapshot ذخیره می‌کند.
// این job فقط از لحظه‌ی فعال‌شدن LiaraApiKey هر کاربر به بعد داده تولید می‌کند — بازه‌های قبلی
// عمداً بدون رکورد می‌مانند (نه صفر اشتباه).
const CONCURRENCY = 5

function yesterdayUtcRange(): { date: Date; from: Date; to: Date } {
  const now = new Date()
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const from = new Date(todayUtc.getTime() - 24 * 60 * 60 * 1000)
  const to = new Date(todayUtc.getTime() - 1)
  return { date: from, from, to }
}

function isImageLog(entry: LiaraLogEntry): boolean {
  return (entry.url ?? '').startsWith('/images')
}

@Processor('liara-usage-sync')
export class LiaraUsageSyncProcessor {
  private readonly logger = new Logger(LiaraUsageSyncProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly management: LiaraManagementService,
  ) {}

  @Process('sync')
  async handleSync() {
    const users = await this.prisma.liaraApiKey.findMany({ select: { userId: true, keyName: true } })
    if (!users.length) return

    const { date, from, to } = yesterdayUtcRange()
    let synced = 0
    let failed = 0

    for (let i = 0; i < users.length; i += CONCURRENCY) {
      const batch = users.slice(i, i + CONCURRENCY)
      await Promise.all(
        batch.map(async ({ userId, keyName }) => {
          try {
            await this.syncOneUser(userId, keyName, date, from, to)
            synced++
          } catch (err) {
            failed++
            this.logger.warn(`Liara usage sync failed for user=${userId}: ${(err as Error).message}`)
          }
        }),
      )
    }

    this.logger.log(`Liara usage sync: ${synced} user(s) synced, ${failed} failed, date=${date.toISOString().slice(0, 10)}`)
  }

  private async syncOneUser(userId: string, keyName: string, date: Date, from: Date, to: Date) {
    const logs = await this.management.fetchUsageLogs(keyName, from, to)

    let realTokensTotal = 0
    let realCostToman = 0
    let realTextCostToman = 0
    let realImageCostToman = 0

    for (const log of logs) {
      const details = log.content?.details
      const tokens = (details?.tokens_prompt ?? 0) + (details?.tokens_completion ?? 0)
      const cost = details?.total_cost_toman ?? 0
      realTokensTotal += tokens
      realCostToman += cost
      if (isImageLog(log)) realImageCostToman += cost
      else realTextCostToman += cost
    }

    await this.prisma.liaraUsageSnapshot.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        realTokensTotal,
        realCostToman,
        realTextCostToman,
        realImageCostToman,
        requestCount: logs.length,
      },
      update: {
        realTokensTotal,
        realCostToman,
        realTextCostToman,
        realImageCostToman,
        requestCount: logs.length,
        syncedAt: new Date(),
      },
    })
  }
}
