import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { embed, cosineSimilarity } from 'ai'
import type { SalesKbKind } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

// docs/PRD-sales-kb-rag-and-plan-context.md بخش الف.۶-الف.۷ —
// بدون pgvector: با مقیاس چند صد نمونه، مقایسه‌ی برداری در حافظه‌ی خود پردازش
// (نه یک افزونه‌ی جدید Postgres) کاملاً کافی و در حد چند میلی‌ثانیه است.
const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const CACHE_TTL_MS = 60_000
const SIMILARITY_THRESHOLD = 0.75
const MAX_RETRIEVED = 5

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
  ) {
    this.provider = createOpenAICompatible({
      name: 'liara',
      baseURL: this.config.get<string>('LIARA_AI_BASE_URL')!,
      apiKey: this.config.get<string>('LIARA_API_KEY')!,
    })
  }

  /** برای sales.service.ts — روی هر پیام کاربر صدا زده می‌شود. */
  async retrieveRelevant(userText: string): Promise<{ userMessage: string; assistantReply: string }[]> {
    const entries = await this.getActiveEntriesCached()
    if (entries.length === 0) return []

    const queryEmbedding = await this.computeEmbedding(userText)
    if (!queryEmbedding) return [] // اگر تماس embedding شکست خورد، پاسخ اصلی بدون بلوک KB ادامه پیدا می‌کند

    return entries
      .map(entry => ({ entry, score: cosineSimilarity(queryEmbedding, entry.embedding) }))
      .filter(s => s.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RETRIEVED)
      .map(s => ({ userMessage: s.entry.userMessage, assistantReply: s.entry.assistantReply }))
  }

  /** برای دکمه‌ی «تست بازیابی» در تب پایگاه دانش ادمین — امتیاز خام همه‌ی نمونه‌های فعال را نشان می‌دهد. */
  async testRetrieval(sampleMessage: string): Promise<RetrievalDebugResult[]> {
    const entries = await this.getActiveEntriesCached()
    const queryEmbedding = await this.computeEmbedding(sampleMessage)
    if (!queryEmbedding) return []

    return entries
      .map(entry => ({
        id: entry.id,
        userMessage: entry.userMessage,
        score: cosineSimilarity(queryEmbedding, entry.embedding),
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
    const embedding = await this.computeEmbedding(input.userMessage)
    const entry = await this.prisma.salesKbEntry.create({
      data: {
        kind: input.kind,
        label: input.label,
        tags: input.tags ?? [],
        userMessage: input.userMessage,
        assistantReply: input.assistantReply,
        note: input.note ?? null,
        isActive: input.isActive ?? true,
        ...(embedding ? { embedding, embeddingModel: EMBEDDING_MODEL } : {}),
      },
    })
    this.invalidateCache()
    return entry
  }

  async update(id: string, input: SalesKbEntryUpdateInput) {
    const data: Record<string, unknown> = { ...input }
    if (input.userMessage !== undefined) {
      const embedding = await this.computeEmbedding(input.userMessage)
      if (embedding) {
        data.embedding = embedding
        data.embeddingModel = EMBEDDING_MODEL
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

  private async getActiveEntriesCached(): Promise<CachedEntry[]> {
    const now = Date.now()
    if (this.cache && now - this.cachedAt < CACHE_TTL_MS) return this.cache

    const rows = await this.prisma.salesKbEntry.findMany({
      where: { isActive: true },
      select: { id: true, userMessage: true, assistantReply: true, embedding: true },
    })

    this.cache = rows
      .filter(r => Array.isArray(r.embedding))
      .map(r => ({
        id: r.id,
        userMessage: r.userMessage,
        assistantReply: r.assistantReply,
        embedding: r.embedding as unknown as number[],
      }))
    this.cachedAt = now
    return this.cache
  }

  private invalidateCache(): void {
    this.cache = null
  }

  private async computeEmbedding(text: string): Promise<number[] | null> {
    try {
      const { embedding } = await embed({
        model: this.provider.embeddingModel(EMBEDDING_MODEL),
        value: text,
      })
      return embedding
    } catch (err) {
      this.logger.error(`embedding computation failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }
}
