import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { embed, cosineSimilarity, generateObject } from 'ai';
import { z } from 'zod';
import type { StoreKbKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { extractChatFileText } from '../../common/utils/chat-file-extraction.util';
import { parseUploadedKbFile } from '../../common/validators/chat-file.validator';
import { fa } from '../../i18n/fa';
import { StoreService } from './store.service';

// docs/PRD-seller-knowledge-base.md — تصحیح صریح: این سرویس‌ *الگوی* SalesKbService را کپی
// می‌کند (embed + cosineSimilarity در حافظه، بدون pgvector)، ولی storeId-محور و کاملاً جدا
// است — SalesKbService یک singleton برای ویجت فروش خودِ nivoai.ir است، نه چندمستأجری.
const EMBEDDING_MODEL = 'openai/text-embedding-3-small'; // همان مدل پیش‌فرض SalesKbService
const CACHE_TTL_MS = 60_000;
const SIMILARITY_THRESHOLD = 0.75;
const MAX_EXTRACTED_CHARS = 20_000;

export interface StoreKbEntryInput {
  kind: StoreKbKind;
  question: string;
  answer: string;
  tags?: string[];
  relatedProductId?: string | null;
}

export type StoreKbEntryUpdateInput = Partial<StoreKbEntryInput> & {
  isActive?: boolean;
};

interface CachedEntry {
  id: string;
  question: string;
  answer: string;
  embedding: number[];
  embeddingModel: string | null;
}

export interface KbCandidateEntry {
  kind: StoreKbKind;
  question: string;
  answer: string;
}

@Injectable()
export class StoreKbService {
  private readonly logger = new Logger(StoreKbService.name);
  private readonly provider;

  private cache = new Map<
    string,
    { entries: CachedEntry[]; cachedAt: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
    private readonly storeService: StoreService,
  ) {
    this.provider = this.aiProvider.buildClient();
  }

  /** برای conversation-engine.service.ts's doFaq — دقیقاً یک بهترین جواب (نه چند نمونه) */
  async retrieveRelevant(
    storeId: string,
    question: string,
  ): Promise<{ question: string; answer: string } | null> {
    const entries = (await this.getActiveEntriesCached(storeId)).filter(
      (e) => e.embeddingModel === EMBEDDING_MODEL,
    );
    if (entries.length === 0) return null;

    const embedded = await this.computeEmbedding(question);
    if (!embedded) return null;

    let best: { entry: CachedEntry; score: number } | null = null;
    for (const entry of entries) {
      const score = cosineSimilarity(embedded, entry.embedding);
      if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) {
        best = { entry, score };
      }
    }
    return best
      ? { question: best.entry.question, answer: best.entry.answer }
      : null;
  }

  async list(sellerId: string, storeId: string, kind?: StoreKbKind) {
    await this.storeService.getOwned(sellerId, storeId);
    return this.prisma.storeKbEntry.findMany({
      where: { storeId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(sellerId: string, storeId: string, input: StoreKbEntryInput) {
    await this.storeService.getOwned(sellerId, storeId);
    const embedded = await this.computeEmbedding(input.question);
    const entry = await this.prisma.storeKbEntry.create({
      data: {
        storeId,
        kind: input.kind,
        question: input.question,
        answer: input.answer,
        tags: input.tags ?? [],
        relatedProductId: input.relatedProductId ?? null,
        ...(embedded
          ? { embedding: embedded, embeddingModel: EMBEDDING_MODEL }
          : {}),
      },
    });
    this.invalidateCache(storeId);
    return entry;
  }

  async update(
    sellerId: string,
    storeId: string,
    id: string,
    input: StoreKbEntryUpdateInput,
  ) {
    await this.getOwnedEntry(sellerId, storeId, id);
    const data: Record<string, unknown> = { ...input };
    if (input.question !== undefined) {
      const embedded = await this.computeEmbedding(input.question);
      if (embedded) {
        data.embedding = embedded;
        data.embeddingModel = EMBEDDING_MODEL;
      }
    }
    const entry = await this.prisma.storeKbEntry.update({
      where: { id },
      data,
    });
    this.invalidateCache(storeId);
    return entry;
  }

  async remove(sellerId: string, storeId: string, id: string) {
    await this.getOwnedEntry(sellerId, storeId, id);
    await this.prisma.storeKbEntry.delete({ where: { id } });
    this.invalidateCache(storeId);
    return { success: true };
  }

  private async getOwnedEntry(sellerId: string, storeId: string, id: string) {
    await this.storeService.getOwned(sellerId, storeId);
    const entry = await this.prisma.storeKbEntry.findUnique({ where: { id } });
    if (!entry || entry.storeId !== storeId) {
      throw new NotFoundException(fa.storeKb.notFound);
    }
    return entry;
  }

  // فایل آپلودی را به چند KB entry کاندید می‌شکند — فروشنده باید قبل از ذخیره‌ی هرکدام
  // تأیید/ویرایش کند (human-in-the-loop، طبق بخش ۳.۳ سند: هیچ‌چیز خودکار ذخیره نمی‌شود)
  async extractCandidatesFromFile(
    sellerId: string,
    storeId: string,
    file: { buffer: Buffer; originalname: string },
  ): Promise<KbCandidateEntry[]> {
    await this.storeService.getOwned(sellerId, storeId);

    const parsed = parseUploadedKbFile(file.buffer, file.originalname);
    if (!parsed) throw new NotFoundException(fa.storeKb.invalidFile);

    const extracted = await extractChatFileText(parsed, MAX_EXTRACTED_CHARS);
    if (!extracted.text.trim()) return [];

    const { object } = await generateObject({
      model: this.provider('openai/gpt-5.4-mini'),
      schema: z.object({
        candidates: z.array(
          z.object({
            kind: z.enum(['FAQ', 'POLICY', 'PRODUCT_INFO', 'GENERAL']),
            question: z.string(),
            answer: z.string(),
          }),
        ),
      }),
      system: `از متن زیر (که فروشنده‌ی یک فروشگاه آنلاین آپلود کرده) چند مورد «سؤال/جواب» یا
«نکته‌ی مهم» برای یک باکس دانش استخراج کن — چیزی که به یک ربات فروش کمک می‌کند به سؤالات
مشتری دقیق‌تر جواب بدهد. هر مورد یک kind مناسب بگیرد:
- FAQ: سؤال متداول با جواب مشخص
- POLICY: شرایط مرجوعی/ارسال/گارانتی
- PRODUCT_INFO: نکته‌ی مربوط به یک محصول خاص
- GENERAL: هرچیز دیگر (معرفی برند، ساعت پاسخ‌گویی، ...)
فقط از متن واقعی استخراج کن، چیزی اضافه نکن. اگر متن هیچ نکته‌ی قابل‌استفاده‌ای نداشت،
آرایه‌ی خالی برگردان.`,
      prompt: extracted.text,
    });

    return object.candidates;
  }

  // دستیار تکمیل محصول با AI (بخش ۲ سند) — مدل هرگز چیزی درباره‌ی قیمت/موجودی واقعی حدس
  // نمی‌زند، فقط description و سؤالات متنی (همان اصل امنیتی «داده‌ی واقعی، نه حدس مدل»)
  async completeProductInfo(
    sellerId: string,
    storeId: string,
    productId: string,
  ) {
    const store = await this.storeService.getOwned(sellerId, storeId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException(fa.store.productNotFound);
    }

    const { object } = await generateObject({
      model: this.provider('openai/gpt-5.4-mini'),
      schema: z.object({
        suggestedDescription: z.string(),
        suggestedQuestions: z.array(z.string()).min(4).max(6),
      }),
      system: `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. برای محصول زیر یک توضیح
کامل‌تر و فروش‌محورتر (فارسی، ۲-۴ جمله) بنویس، و ۴ تا ۶ سؤال رایج که مشتری‌های این‌جور محصول
معمولاً می‌پرسند لیست کن (فقط خودِ سؤال‌ها، بدون جواب). هرگز قیمت/موجودی/مشخصات دقیقی که در
ورودی نیامده را حدس نزن یا اختراع نکن — فقط چیزی که از نام محصول و دسته‌بندی فروشگاه قابل‌استنتاج
است. پاسخ را فقط به‌صورت یک شیء JSON معتبر مطابق اسکیمای داده‌شده برگردان.`,
      prompt: `دسته‌بندی فروشگاه: ${store.category ?? 'نامشخص'}
نام محصول: ${product.name}
توضیح فعلی: ${product.description ?? '(هنوز توضیحی ثبت نشده)'}`,
    });

    return object;
  }

  private async getActiveEntriesCached(
    storeId: string,
  ): Promise<CachedEntry[]> {
    const cached = this.cache.get(storeId);
    const now = Date.now();
    if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.entries;

    const rows = await this.prisma.storeKbEntry.findMany({
      where: { storeId, isActive: true },
      select: {
        id: true,
        question: true,
        answer: true,
        embedding: true,
        embeddingModel: true,
      },
    });

    const entries = rows
      .filter((r) => Array.isArray(r.embedding))
      .map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        embedding: r.embedding as unknown as number[],
        embeddingModel: r.embeddingModel,
      }));
    this.cache.set(storeId, { entries, cachedAt: now });
    return entries;
  }

  private invalidateCache(storeId: string): void {
    this.cache.delete(storeId);
  }

  private async computeEmbedding(text: string): Promise<number[] | null> {
    try {
      const { embedding } = await embed({
        model: this.provider.embeddingModel(EMBEDDING_MODEL),
        value: text,
      });
      return embedding;
    } catch (err) {
      this.logger.error(
        `embedding computation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
