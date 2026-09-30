import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { embed, cosineSimilarity, generateObject } from 'ai';
import { z } from 'zod';
import type { StoreKbKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { extractChatFileText } from '../../common/utils/chat-file-extraction.util';
import { parseUploadedKbFile } from '../../common/validators/chat-file.validator';
import { fetchProductPage } from '../../common/utils/fetch-product-page.util';
import { fa } from '../../i18n/fa';
import { PricingService } from '../usage/pricing.service';
import { StoreService } from './store.service';

// docs/PRD-seller-knowledge-base.md بخش ۲.۳ — دقیقاً همان shape که chat.service.ts's
// OPENROUTER_WEB_SEARCH_TOOLS استفاده می‌کند (کپی محلی، نه import — آن فایل چیزی export نمی‌کند
// و این دو دامنه‌ی جدا هستند). engine:'auto' برای مدل‌های بدون جستجوی بومی به Exa می‌افتد،
// پس نیازی به gate‌کردن روی AiModel.supportsWebSearch (که مخصوص محصول چت اصلی است) نیست.
const PRODUCT_ENRICHMENT_WEB_SEARCH_TOOLS = [
  {
    type: 'openrouter:web_search',
    parameters: {
      engine: 'auto',
      max_results: 5,
      max_uses: 3,
      max_total_results: 15,
    },
  },
  { type: 'openrouter:datetime' },
];

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
    private readonly pricing: PricingService,
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
  // نمی‌زند، فقط description و سؤالات متنی (همان اصل امنیتی «داده‌ی واقعی، نه حدس مدل»).
  // withWebSearch (بخش ۲.۳) — گران‌تر از حالت معمولی، پس از اعتبار واقعی فروشگاه کم می‌شود
  async completeProductInfo(
    sellerId: string,
    storeId: string,
    productId: string,
    withWebSearch = false,
  ) {
    const store = await this.storeService.getOwned(sellerId, storeId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException(fa.store.productNotFound);
    }
    if (withWebSearch && store.creditBalanceToman <= 0) {
      throw new BadRequestException(fa.store.insufficientCreditForWebSearch);
    }

    const model = 'openai/gpt-5.4-mini';
    // نکته: قبلاً suggestedQuestions .min(4).max(6) بود — اگر مدل دقیقاً ۴ تا ۶ مورد
    // برنمی‌گرداند (مثلاً ۳ یا ۷ تا)، اعتبارسنجی zod توی generateObject fail می‌شد و کل
    // درخواست با خطا می‌ترکید (دقیقاً همون چیزی که فروشنده می‌دید: «تولید پیشنهاد با خطا
    // مواجه شد»). اینجا محدودیت سخت‌گیرانه را برمی‌داریم و بازه‌ی ۴-۶ را خودمان بعد از جواب
    // اعمال می‌کنیم — یک جواب کوتاه/بلندتر از حد نباید کل فیچر را بترکاند.
    try {
      const { object, usage } = await generateObject({
        model: withWebSearch
          ? this.aiProvider.buildClient(undefined, undefined, {
              tools: PRODUCT_ENRICHMENT_WEB_SEARCH_TOOLS,
              max_tool_calls: 5,
            })(model)
          : this.provider(model),
        schema: z.object({
          suggestedDescription: z.string(),
          suggestedQuestions: z.array(z.string()).min(1),
          ...(withWebSearch
            ? {
                suggestedSpecs: z
                  .array(z.object({ label: z.string(), value: z.string() }))
                  .optional(),
                sourceNote: z.string().optional(),
              }
            : {}),
        }),
        system: withWebSearch
          ? `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. نام محصول زیر را در وب جستجو کن
و توضیح/مشخصات واقعی‌اش را پیدا کن. یک توضیح کامل‌تر و فروش‌محورتر (فارسی، ۲-۴ جمله) بنویس،
۴ تا ۶ سؤال رایج که مشتری‌های این‌جور محصول معمولاً می‌پرسند لیست کن، و اگر مشخصات فنی واقعی
(جنس/سایزبندی/...) پیدا کردی در suggestedSpecs بگذار. sourceNote یک جمله‌ی کوتاه بگو از کجا
این اطلاعات آمد. هرگز قیمت/موجودی/کد محصول پیشنهاد نده — این‌ها فقط از فروشنده می‌آیند. اگر
جستجو چیز معنی‌داری پیدا نکرد (محصول عمومی/بی‌نام‌تجاری)، به‌جای اطلاعات جعلی یک توضیح عمومی‌تر
بده و sourceNote را خالی بگذار. پاسخ را فقط به‌صورت یک شیء JSON معتبر مطابق اسکیمای داده‌شده برگردان.`
          : `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. برای محصول زیر یک توضیح
کامل‌تر و فروش‌محورتر (فارسی، ۲-۴ جمله) بنویس، و ۴ تا ۶ سؤال رایج که مشتری‌های این‌جور محصول
معمولاً می‌پرسند لیست کن (فقط خودِ سؤال‌ها، بدون جواب). هرگز قیمت/موجودی/مشخصات دقیقی که در
ورودی نیامده را حدس نزن یا اختراع نکن — فقط چیزی که از نام محصول و دسته‌بندی فروشگاه قابل‌استنتاج
است. پاسخ را فقط به‌صورت یک شیء JSON معتبر مطابق اسکیمای داده‌شده برگردان.`,
        prompt: `دسته‌بندی فروشگاه: ${store.category ?? 'نامشخص'}
نام محصول: ${product.name}
توضیح فعلی: ${product.description ?? '(هنوز توضیحی ثبت نشده)'}`,
      });

      if (withWebSearch) {
        const { costToman } = await this.pricing.calcCost(
          usage.inputTokens ?? 0,
          usage.outputTokens ?? 0,
          model,
        );
        await this.prisma.creditUsageEvent.create({
          data: {
            storeId,
            model,
            kind: 'PRODUCT_ENRICHMENT',
            costToman,
            isFreeQuota: false,
          },
        });
        await this.prisma.store.update({
          where: { id: storeId },
          data: { creditBalanceToman: { decrement: costToman } },
        });
      }

      return {
        suggestedDescription: object.suggestedDescription,
        suggestedQuestions: object.suggestedQuestions.slice(0, 6),
        suggestedSpecs: object.suggestedSpecs,
        sourceNote: object.sourceNote,
      };
    } catch (err) {
      this.logger.error(
        `completeProductInfo failed for product=${productId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // ورود سریع محصول از لینک صفحه‌ی موجود (بخش ۲.۵) — فقط پیش‌نمایش، هیچ‌چیز خودکار ذخیره
  // نمی‌شود؛ فروشنده در فرم افزودن محصول موجود فیلدهای پرشده را می‌بیند و خودش تأیید می‌کند
  async importProductFromUrl(sellerId: string, storeId: string, url: string) {
    await this.storeService.getOwned(sellerId, storeId);

    let page;
    try {
      page = await fetchProductPage(url);
    } catch (err) {
      this.logger.error(
        `importProductFromUrl fetch failed for ${url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new BadRequestException(fa.store.urlNotReadable);
    }
    if (!page.text && !page.ogDescription && !page.title) {
      throw new BadRequestException(fa.store.urlNotReadable);
    }

    const { object } = await generateObject({
      model: this.provider('openai/gpt-5.4-mini'),
      schema: z.object({
        name: z.string(),
        suggestedDescription: z.string(),
        suggestedSpecs: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .optional(),
        priceHint: z.number().int().positive().nullable().optional(),
      }),
      system: `از محتوای زیر (که از یک صفحه‌ی محصول واقعی فچ شده) اطلاعات محصول را استخراج کن —
نام محصول، یک توضیح فروش‌محور فارسی (حتی اگر متن اصلی انگلیسی بود، فارسی برگردان)، و اگر
مشخصات فنی مشخصی (مثل جنس/سایز/رنگ) در متن بود به‌صورت لیست suggestedSpecs. priceHint فقط اگر
قیمتی صریح در متن آمده بود — اگر قیمتی پیدا نشد priceHint را خالی بگذار، حدس نزن. هیچ‌چیزی که
در متن نیامده اختراع نکن؛ اگر متن اطلاعات کمی داشت، یک توضیح عمومی‌تر و کوتاه‌تر بده، نه
اطلاعات جعلی. پاسخ را فقط به‌صورت یک شیء JSON معتبر مطابق اسکیمای داده‌شده برگردان.`,
      prompt: `عنوان صفحه: ${page.title ?? '(نامشخص)'}
توضیح OG: ${page.ogDescription ?? '(ندارد)'}
متن صفحه: ${page.text || '(متن قابل‌استخراجی نبود)'}`,
    });

    return {
      name: object.name,
      suggestedDescription: object.suggestedDescription,
      suggestedSpecs: object.suggestedSpecs,
      priceHint: object.priceHint ?? undefined,
      imageUrls: page.imageUrls,
    };
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
