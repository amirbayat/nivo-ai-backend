import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { embed, cosineSimilarity } from 'ai'
import type { SalesKbKind } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { PricingService } from '../usage/pricing.service'
import { SalesConfigService } from './sales-config.service'

// docs/PRD-sales-kb-rag-and-plan-context.md بخش الف.۶-الف.۷ —
// بدون pgvector: با مقیاس چند صد نمونه، مقایسه‌ی برداری در حافظه‌ی خود پردازش
// (نه یک افزونه‌ی جدید Postgres) کاملاً کافی و در حد چند میلی‌ثانیه است.
const CACHE_TTL_MS = 60_000
const SIMILARITY_THRESHOLD = 0.75
const MAX_RETRIEVED = 5

const IRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000
function iranDate(): string {
  return new Date(Date.now() + IRAN_OFFSET_MS).toISOString().slice(0, 10)
}

export interface SalesKbEntryInput {
  kind: SalesKbKind
  label: string
  tags?: string[]
  userMessage: string
  assistantReply: string
  note?: string | null
  isActive?: boolean
}

export type SalesKbEntryUpdateInput = Partial<SalesKbEntryInput>

interface CachedEntry {
  id: string
  userMessage: string
  assistantReply: string
  embedding: number[]
  embeddingModel: string | null
}

export interface RetrievalDebugResult {
  id: string
  userMessage: string
  score: number
}

/**
 * پایگاه دانش فروش برای بازیابی معنایی (RAG) — docs/PRD-sales-kb-rag-and-plan-context.md بخش الف.
 * embedding هر نمونه فقط یک‌بار (روی ذخیره‌ی ادمین) محاسبه می‌شود؛ کش درون‌حافظه‌ای مشابه
 * الگوی SalesConfigService، چون هر instance backend با تأخیر حداکثر ۶۰ ثانیه‌ای قابل قبول است.
 *
 * مدل embedding از SalesConfigService (قابل تغییر در ادمین) خوانده می‌شود، نه هاردکد —
 * پس هر نمونه‌ی موجود embeddingModel خودش را کنار بردارش نگه می‌دارد و هنگام بازیابی فقط
 * نمونه‌هایی که با مدل *فعلی* محاسبه شده‌اند مقایسه می‌شوند (مقایسه‌ی برداری بین دو مدل
 * embedding متفاوت بی‌معناست). بعد از تغییر مدل در ادمین، باید «بازمحاسبه‌ی همه» زده شود.
 */
@Injectable()
export class SalesKbService {
  private readonly logger = new Logger(SalesKbService.name)
  private readonly provider

  private cache: CachedEntry[] | null = null
  private cachedAt = 0

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly salesConfig: SalesConfigService,
    private readonly pricing: PricingService,
  ) {
    this.provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey: this.config.get<string>('LIARA_API_KEY')!,
    })
  }

  /** برای sales.service.ts — روی هر پیام کاربر صدا زده می‌شود. */
  async retrieveRelevant(userText: string): Promise<{ userMessage: string; assistantReply: string }[]> {
    const activeModel = await this.getActiveEmbeddingModel()
    const allCached = await this.getActiveEntriesCached()
    const entries = allCached.filter(e => e.embeddingModel === activeModel)
    const staleCount = allCached.length - entries.length

    if (entries.length === 0) {
      this.logger.log(
        `[sales-kb.retrieve] query="${userText}" model=${activeModel} → هیچ نمونه‌ی فعالِ هم‌مدل نیست ` +
          `(${allCached.length} نمونه‌ی فعال کل, ${staleCount} با مدل قدیمی/ناهماهنگ) → بدون بلوک KB`,
      )
      return []
    }

    const embedded = await this.computeEmbedding(userText, activeModel)
    if (!embedded) {
      this.logger.warn(`[sales-kb.retrieve] query="${userText}" → محاسبه‌ی embedding شکست خورد، بدون بلوک KB ادامه می‌دهیم`)
      return [] // اگر تماس embedding شکست خورد، پاسخ اصلی بدون بلوک KB ادامه پیدا می‌کند
    }

    const scored = entries
      .map(entry => ({ entry, score: cosineSimilarity(embedded.embedding, entry.embedding) }))
      .sort((a, b) => b.score - a.score)

    const selected = scored.filter(s => s.score >= SIMILARITY_THRESHOLD).slice(0, MAX_RETRIEVED)

    this.logger.log(
      `[sales-kb.retrieve] query="${userText}" model=${activeModel} ` +
        `candidates=${entries.length}(${staleCount} stale skipped) threshold=${SIMILARITY_THRESHOLD}\n` +
        `--- امتیاز همه‌ی کاندیدها (بالا به پایین) ---\n` +
        scored.map(s => `${s.score >= SIMILARITY_THRESHOLD ? '✅' : '  '} ${s.score.toFixed(4)} — ${s.entry.userMessage}`).join('\n') +
        `\n--- ${selected.length} مورد انتخاب‌شده و ضمیمه‌شده به system prompt ---\n` +
        (selected.length
          ? selected.map(s => `کاربر: ${s.entry.userMessage}\nپاسخ: ${s.entry.assistantReply}`).join('\n---\n')
          : '(هیچ‌کدام از آستانه بالاتر نرفت — هیچ بلوکی اضافه نمی‌شود)'),
    )

    return selected.map(s => ({ userMessage: s.entry.userMessage, assistantReply: s.entry.assistantReply }))
  }

  /** برای دکمه‌ی «تست بازیابی» در تب پایگاه دانش ادمین — امتیاز خام همه‌ی نمونه‌های فعال را نشان می‌دهد. */
  async testRetrieval(sampleMessage: string): Promise<RetrievalDebugResult[]> {
    const activeModel = await this.getActiveEmbeddingModel()
    const entries = (await this.getActiveEntriesCached()).filter(e => e.embeddingModel === activeModel)
    const embedded = await this.computeEmbedding(sampleMessage, activeModel)
    if (!embedded) return []

    return entries
      .map(entry => ({
        id: entry.id,
        userMessage: entry.userMessage,
        score: cosineSimilarity(embedded.embedding, entry.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
  }

  async list(kind?: SalesKbKind) {
    return this.prisma.salesKbEntry.findMany({
      where: kind ? { kind } : {},
      orderBy: { createdAt: 'desc' },
    })
  }

  async create(input: SalesKbEntryInput) {
    const activeModel = await this.getActiveEmbeddingModel()
    const embedded = await this.computeEmbedding(input.userMessage, activeModel)
    const entry = await this.prisma.salesKbEntry.create({
      data: {
        kind: input.kind,
        label: input.label,
        tags: input.tags ?? [],
        userMessage: input.userMessage,
        assistantReply: input.assistantReply,
        note: input.note ?? null,
        isActive: input.isActive ?? true,
        ...(embedded ? { embedding: embedded.embedding, embeddingModel: activeModel } : {}),
      },
    })
    this.invalidateCache()
    return entry
  }

  async update(id: string, input: SalesKbEntryUpdateInput) {
    const data: Record<string, unknown> = { ...input }
    if (input.userMessage !== undefined) {
      const activeModel = await this.getActiveEmbeddingModel()
      const embedded = await this.computeEmbedding(input.userMessage, activeModel)
      if (embedded) {
        data.embedding = embedded.embedding
        data.embeddingModel = activeModel
      }
    }
    const entry = await this.prisma.salesKbEntry.update({ where: { id }, data })
    this.invalidateCache()
    return entry
  }

  async remove(id: string) {
    await this.prisma.salesKbEntry.delete({ where: { id } })
    this.invalidateCache()
  }

  /** آپلود دسته‌ای از تب ادمین — عمداً پی‌درپی (نه Promise.all) تا فشار ناگهانی به Liara وارد نشود. */
  async bulkImport(inputs: SalesKbEntryInput[]): Promise<{ created: number; failed: number; errors: string[] }> {
    let created = 0
    const errors: string[] = []
    for (const input of inputs) {
      try {
        await this.create(input)
        created++
      } catch (err) {
        errors.push(`"${input.label}": ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return { created, failed: errors.length, errors }
  }

  /**
   * بعد از تغییر مدل embedding در ادمین، بردارهای قدیمی با مدل جدید قابل مقایسه نیستند —
   * این متد همه‌ی نمونه‌ها را با مدل فعلی دوباره embed می‌کند. عمداً همه (حتی isActive=false).
   */
  async recomputeAll(): Promise<{ updated: number; failed: number }> {
    const activeModel = await this.getActiveEmbeddingModel()
    const all = await this.prisma.salesKbEntry.findMany({ select: { id: true, userMessage: true } })
    let updated = 0
    let failed = 0
    for (const row of all) {
      const embedded = await this.computeEmbedding(row.userMessage, activeModel)
      if (!embedded) {
        failed++
        continue
      }
      await this.prisma.salesKbEntry.update({
        where: { id: row.id },
        data: { embedding: embedded.embedding, embeddingModel: activeModel },
      })
      updated++
    }
    this.invalidateCache()
    return { updated, failed }
  }

  private async getActiveEmbeddingModel(): Promise<string> {
    const cfg = await this.salesConfig.getConfig()
    return cfg.embeddingModel
  }

  private async getActiveEntriesCached(): Promise<CachedEntry[]> {
    const now = Date.now()
    if (this.cache && now - this.cachedAt < CACHE_TTL_MS) return this.cache

    const rows = await this.prisma.salesKbEntry.findMany({
      where: { isActive: true },
      select: { id: true, userMessage: true, assistantReply: true, embedding: true, embeddingModel: true },
    })

    this.cache = rows
      .filter(r => Array.isArray(r.embedding))
      .map(r => ({
        id: r.id,
        userMessage: r.userMessage,
        assistantReply: r.assistantReply,
        embedding: r.embedding as unknown as number[],
        embeddingModel: r.embeddingModel,
      }))
    this.cachedAt = now
    return this.cache
  }

  private invalidateCache(): void {
    this.cache = null
  }

  private async computeEmbedding(text: string, modelId: string): Promise<{ embedding: number[] } | null> {
    try {
      const { embedding, usage } = await embed({
        model: this.provider.embeddingModel(modelId),
        value: text,
      })
      this.logger.log(`[sales-kb.embed] model=${modelId} tokens=${usage.tokens} text="${text}"`)
      this.recordEmbeddingUsage(usage.tokens, modelId).catch(() => {})
      return { embedding }
    } catch (err) {
      this.logger.error(`[sales-kb.embed] model=${modelId} text="${text}" شکست خورد: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  // آنالیتیکس هزینه‌ی embedding — جدا از هزینه‌ی چت روی همان sales_bot_daily_usage
  // (docs/PRD-sales-kb-rag-and-plan-context.md بخش الف.۱۲). شکست این بخش هرگز نباید
  // پاسخ اصلی به کاربر را fail کند — همیشه با .catch بی‌صدا فراخوانی می‌شود.
  private async recordEmbeddingUsage(tokens: number, modelId: string): Promise<void> {
    const cost = await this.pricing.calcCost(tokens, 0, modelId)
    const date = new Date(iranDate())
    await this.prisma.salesBotDailyUsage.upsert({
      where: { date },
      create: {
        date,
        embeddingCalls: 1,
        embeddingTokens: tokens,
        embeddingCostToman: cost.costToman,
        embeddingCostUsdMicros: cost.costUsdMicros,
      },
      update: {
        embeddingCalls: { increment: 1 },
        embeddingTokens: { increment: tokens },
        embeddingCostToman: { increment: cost.costToman },
        embeddingCostUsdMicros: { increment: cost.costUsdMicros },
      },
    })
  }
}
