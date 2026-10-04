import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { embed, cosineSimilarity, generateObject, generateText } from 'ai';
import type { RepairTextFunction, UserModelMessage } from 'ai';
import { z } from 'zod';
import type { StoreKbKind, CanonicalProduct } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import {
  AsrService,
  VOICE_MESSAGE_ASR_CHAIN,
} from '../../common/services/asr.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import { extractChatFileText } from '../../common/utils/chat-file-extraction.util';
import { parseUploadedKbFile } from '../../common/validators/chat-file.validator';
import { fetchProductPage } from '../../common/utils/fetch-product-page.util';
import { fa } from '../../i18n/fa';
import { PricingService } from '../usage/pricing.service';
import { StoreService } from './store.service';
import { CommentsService } from '../comments/comments.service';
import { defaultModel } from '../sales-agent/model-variants';
import { clampProductSpecs } from './product-specs.types';

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

// docs/PRD-seller-knowledge-base.md بخش ۲.۴ — اگر یک CanonicalProduct مشترک تازه‌تر از این
// باشد، به‌جای فراخوان جدید وب‌سرچ همان نتیجه استفاده می‌شود (بدون کسر اعتبار).
const CANONICAL_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// سقف‌های خروجی تولیدشده توسط AI قبل از persist در DB (CanonicalProduct/ProductEnrichmentDraft/
// Product.description). عمداً این‌ها در خودِ zod schema بالا به‌صورت .max() نیستند — اگر آنجا
// بودند و مدل بیشتر می‌نوشت، generateObject دوباره با AI_NoObjectGeneratedError («response did
// not match schema») می‌ترکید، یعنی همان باگی که اینجا داریم حلش می‌کنیم. این توابع بعد از
// این‌که generateObject یک شیء معتبر برگرداند صدا زده می‌شوند و truncate/dedupe می‌کنند، reject
// نمی‌کنند.
const MAX_SUGGESTED_DESCRIPTION_CHARS = 1000;
const MAX_SUGGESTED_QUESTIONS = 6;
const MAX_QUESTION_CHARS = 200;
const MAX_SOURCE_NOTE_CHARS = 300;

function clampEnrichmentOutput<
  T extends {
    suggestedDescription: string;
    suggestedQuestions: string[];
    suggestedSpecs?: { label: string; value: string }[];
    sourceNote?: string;
  },
>(input: T): T {
  const suggestedQuestions: string[] = [];
  const seen = new Set<string>();
  for (const q of input.suggestedQuestions) {
    const trimmed = q.trim().slice(0, MAX_QUESTION_CHARS);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    suggestedQuestions.push(trimmed);
    if (suggestedQuestions.length >= MAX_SUGGESTED_QUESTIONS) break;
  }

  return {
    ...input,
    suggestedDescription: input.suggestedDescription
      .trim()
      .slice(0, MAX_SUGGESTED_DESCRIPTION_CHARS),
    suggestedQuestions,
    suggestedSpecs: clampProductSpecs(input.suggestedSpecs),
    sourceNote:
      input.sourceNote?.trim().slice(0, MAX_SOURCE_NOTE_CHARS) || undefined,
  };
}

const ADMIN_RESOURCE_SYSTEM_PROMPT = `تو دستیار تیم محتوای نیوو هستی. یک ادمین یک منبع متنی
(مثلاً از سایت تامین‌کننده) درباره‌ی یک محصول پیدا کرده و برایت پیست کرده. از همین متن یک
توضیح کامل و فروش‌محور فارسی (۲-۴ جمله) و مشخصات فنی واقعی (در صورت وجود) استخراج کن. هرگز
چیزی که در متن نیامده حدس نزن یا اختراع نکن — اگر متن اطلاعات کمی داشت، توضیح کوتاه‌تر و
عمومی‌تر بده، نه اطلاعات جعلی. هرگز قیمت/موجودی را در توضیح نیاور. ۴ تا ۶ سؤال رایج مشتری هم
لیست کن (فقط خودِ سؤال‌ها، بدون جواب). پاسخ را فقط به‌صورت یک شیء JSON معتبر مطابق اسکیمای
داده‌شده برگردان.`;

const BASIC_SUGGESTIONS_SYSTEM_PROMPT = `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. برای محصول زیر یک توضیح
کامل‌تر و فروش‌محورتر (فارسی، ۲-۴ جمله) بنویس، و ۴ تا ۶ سؤال رایج که مشتری‌های این‌جور محصول
معمولاً می‌پرسند لیست کن (فقط خودِ سؤال‌ها، بدون جواب). هرگز قیمت/موجودی/مشخصات دقیقی که در
ورودی نیامده را حدس نزن یا اختراع نکن — فقط چیزی که از نام محصول و دسته‌بندی فروشگاه قابل‌استنتاج
است. پاسخ را فقط به‌صورت یک شیء JSON معتبر مطابق اسکیمای داده‌شده برگردان.`;

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
    private readonly comments: CommentsService,
    private readonly asr: AsrService,
    private readonly mediaTranscode: MediaTranscodeService,
  ) {
    // supportsStructuredOutputs=true — بدون این، @ai-sdk/openai-compatible فقط
    // response_format: {type:'json_object'} می‌فرستد (JSON معتبر ولی بدون تضمین سمت سرور برای
    // شکل schema)، و مدل آزاد است اسم/نوع فیلدها را خودش حدس بزند (دقیقاً علت
    // AI_NoObjectGeneratedError «response did not match schema» که برای adminGenerateEnrichmentDraft
    // دیده شد). همان الگوی nivo-cal.service.ts/chat.service.ts/sales-agent-qa.service.ts.
    this.provider = this.aiProvider.buildClient(undefined, {
      supportsStructuredOutputs: true,
    });
  }

  // دفاع لایه‌ی دوم برای AI_NoObjectGeneratedError: ریشه‌ی اصلی مشکل با supportsStructuredOutputs
  // بالا فیکس می‌شود، ولی اگر OpenRouter یک درخواست را به زیر-providerای route کند که json_schema
  // سخت‌گیر را کامل رعایت نمی‌کند، بازهم ممکن است رخ دهد. اینجا یک بار با همان خروجی نادرست +
  // پیام دقیق خطای zod (که مسیر/نوع دقیق فیلد درست یا گم‌شده را می‌گوید، مثلاً «suggestedDescription
  // expected string received undefined») از مدل می‌خواهیم فقط ساختار را اصلاح کند — چیزی اختراع
  // نمی‌شود. عمداً از کلاینت بدون tools استفاده می‌کند (نه همان کلاینتی که وب‌سرچ دارد) چون در این
  // مرحله فقط بازنویسی متن لازم است، نه یک جستجوی وب جدید.
  private repairStructuredOutput(): RepairTextFunction {
    return async ({ text, error }) => {
      try {
        const { text: repaired } = await generateText({
          model: this.provider('openai/gpt-5.4-mini'),
          system: `خروجی زیر باید دقیقاً یک شیء JSON معتبر مطابق schema مورد انتظار باشد ولی رد
شده. با توجه به پیام خطای اعتبارسنجی (که اسم/نوع دقیق فیلدهای درست را می‌گوید)، همان محتوا را در
ساختار صحیح بازنویسی کن — هیچ اطلاعات جدیدی اضافه نکن، فقط شکل/اسم فیلدها را اصلاح کن. فقط خودِ
JSON را برگردان، بدون توضیح یا markdown fence.`,
          prompt: `خروجی نادرست:\n${text}\n\nخطای اعتبارسنجی:\n${error.message}`,
        });
        return repaired;
      } catch (repairErr) {
        this.logger.warn(
          `structured output repair failed: ${
            repairErr instanceof Error ? repairErr.message : String(repairErr)
          }`,
        );
        return null;
      }
    };
  }

  // ابزار داخلی فروشنده روی فرم محصول (میکروفون کنار توضیحات) — فیدبک کاربر ۱۴۰۵/۰۷/۰۱.
  // عمداً هیچ semantics مکالمه/billing ندارد (این مصرف مشتری نیست)؛ همان الگوی
  // sales-agent.service.ts's submitVoiceMessage (extractAudio → ASR بدون timestamp کلمه‌ای)
  async transcribeDescription(
    sellerId: string,
    storeId: string,
    file: { buffer: Buffer; originalname: string },
  ): Promise<{ text: string }> {
    await this.storeService.getOwned(sellerId, storeId);
    const ext = file.originalname.split('.').pop() || 'webm';
    const mp3Buffer = await this.mediaTranscode.extractAudio(file.buffer, ext);
    const transcript = await this.asr.transcribeWithFallback(
      mp3Buffer,
      this.aiProvider.sharedApiKey,
      'fa',
      undefined,
      VOICE_MESSAGE_ASR_CHAIN,
      false,
    );
    return { text: transcript.text };
  }

  // docs/PRD-customer-comments-and-discounts.md بخش الف/۶ — نظرات تاییدشده یک منبع کمکی برای
  // واقعی‌تر‌شدن پیشنهاد AI هستند («طبق نظر خریداران، سایزبندی کمی کوچیکه»)؛ فروشنده همچنان
  // تایید نهایی متن را می‌دهد (human-in-the-loop، بدون تغییر)
  private async commentsHint(productId: string): Promise<string> {
    const approved = await this.comments.getApprovedForProduct(productId, 5);
    if (approved.length === 0) return '';
    return `\nچیزهایی که مشتری‌های واقعی این محصول گفته‌اند: ${approved.map((c) => `«${c.text}»`).join(' / ')}`;
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
      experimental_repairText: this.repairStructuredOutput(),
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
    currentDraft?: string,
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

    // docs/PRD-seller-knowledge-base.md بخش ۲.۴ — قبل از جستجوی وب گران، چک می‌کنیم آیا
    // محصول مشابهی قبلاً در فروشگاه دیگری enrich شده. اگر تازه بود (کمتر از ۳۰ روز)، همان
    // نتیجه به‌جای فراخوان جدید وب‌سرچ استفاده می‌شود — بدون کسر اعتبار. اگر قدیمی بود، همان
    // ردیف بعد از جستجوی تازه آپدیت می‌شود (نه یک ردیف تکراری جدید).
    let freshCanonical: CanonicalProduct | null = null;
    let staleCanonical: CanonicalProduct | null = null;
    const normalizedName = normalizeProductName(product.name);
    if (withWebSearch) {
      const existing = await this.prisma.canonicalProduct.findFirst({
        where: { normalizedName },
      });
      if (existing) {
        const isFresh =
          Date.now() - existing.lastEnrichedAt.getTime() <
          CANONICAL_FRESHNESS_MS;
        if (isFresh) freshCanonical = existing;
        else staleCanonical = existing;
      }
    }

    const model = 'openai/gpt-5.4-mini';
    const commentsHint = await this.commentsHint(productId);
    try {
      if (freshCanonical) {
        const basic = await this.generateBasicSuggestions(
          store,
          product,
          commentsHint,
        );
        await this.prisma.canonicalProduct.update({
          where: { id: freshCanonical.id },
          data: { sourceCount: { increment: 1 } },
        });
        if (product.canonicalProductId !== freshCanonical.id) {
          await this.prisma.product.update({
            where: { id: productId },
            data: { canonicalProductId: freshCanonical.id },
          });
        }
        return {
          suggestedDescription: freshCanonical.richDescription,
          suggestedQuestions: basic.suggestedQuestions.slice(0, 6),
          suggestedSpecs: freshCanonical.specs as
            { label: string; value: string }[] | undefined,
          sourceNote:
            'این توضیحات قبلاً برای محصول مشابه در فروشگاه دیگری تایید شده است.',
        };
      }

      // نکته: قبلاً suggestedQuestions .min(4).max(6) بود — اگر مدل دقیقاً ۴ تا ۶ مورد
      // برنمی‌گرداند (مثلاً ۳ یا ۷ تا)، اعتبارسنجی zod توی generateObject fail می‌شد و کل
      // درخواست با خطا می‌ترکید (دقیقاً همون چیزی که فروشنده می‌دید: «تولید پیشنهاد با خطا
      // مواجه شد»). اینجا محدودیت سخت‌گیرانه را برمی‌داریم و بازه‌ی ۴-۶ را خودمان بعد از جواب
      // اعمال می‌کنیم — یک جواب کوتاه/بلندتر از حد نباید کل فیچر را بترکاند.
      const { object: rawObject, usage } = await generateObject({
        model: withWebSearch
          ? this.aiProvider.buildClient(
              undefined,
              { supportsStructuredOutputs: true },
              {
                tools: PRODUCT_ENRICHMENT_WEB_SEARCH_TOOLS,
                max_tool_calls: 5,
              },
            )(model)
          : this.provider(model),
        // suggestedSpecs/sourceNote همیشه (نه فقط withWebSearch) در schema هستند، صرفاً optional —
        // یک z.object شرطی با ternary باعث می‌شد TypeScript نوع این دو فیلد را «unknown» استنتاج
        // کند (چون z.object نمی‌تواند شکل دقیق یک spread شرطی را در compile-time حل کند)، و این
        // دقیقاً همان کلمپ/اعتبارسنجی بعدی (clampEnrichmentOutput) را به خطر می‌انداخت. مدل در
        // حالت بدون وب‌سرچ طبق BASIC_SUGGESTIONS_SYSTEM_PROMPT اصلاً درخواست این دو فیلد را
        // نمی‌بیند، پس عملاً خالی می‌مانند.
        schema: z.object({
          suggestedDescription: z.string(),
          suggestedQuestions: z.array(z.string()).min(1),
          suggestedSpecs: z
            .array(z.object({ label: z.string(), value: z.string() }))
            .optional(),
          sourceNote: z.string().optional(),
        }),
        system: withWebSearch
          ? `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. نام محصول زیر را در وب جستجو کن
و توضیح/مشخصات واقعی‌اش را پیدا کن. یک توضیح کامل‌تر و فروش‌محورتر (فارسی، ۲-۴ جمله) بنویس،
۴ تا ۶ سؤال رایج که مشتری‌های این‌جور محصول معمولاً می‌پرسند لیست کن، و اگر مشخصات فنی واقعی
(جنس/سایزبندی/...) پیدا کردی در suggestedSpecs بگذار. sourceNote یک جمله‌ی کوتاه بگو از کجا
این اطلاعات آمد. هرگز قیمت/موجودی/کد محصول پیشنهاد نده — این‌ها فقط از فروشنده می‌آیند. این
توضیح ممکن است بین چند فروشگاه مشابه به اشتراک گذاشته شود — هرگز نام فروشگاه، لینک، یا شرایط
ارسال/بازگشت مخصوص یک فروشگاه را در توضیح نیاور، فقط توضیح عمومی خودِ محصول. اگر جستجو چیز
معنی‌داری پیدا نکرد (محصول عمومی/بی‌نام‌تجاری)، به‌جای اطلاعات جعلی یک توضیح عمومی‌تر بده و
sourceNote را خالی بگذار. پاسخ را فقط به‌صورت یک شیء JSON معتبر مطابق اسکیمای داده‌شده برگردان.`
          : BASIC_SUGGESTIONS_SYSTEM_PROMPT,
        prompt: `دسته‌بندی فروشگاه: ${store.category ?? 'نامشخص'}
نام محصول: ${product.name}
توضیح فعلی: ${currentDraft ?? product.description ?? '(هنوز توضیحی ثبت نشده)'}${commentsHint}`,
        experimental_repairText: this.repairStructuredOutput(),
      });
      const object = clampEnrichmentOutput(rawObject);

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

        const savedCanonical = staleCanonical
          ? await this.prisma.canonicalProduct.update({
              where: { id: staleCanonical.id },
              data: {
                richDescription: object.suggestedDescription,
                specs: object.suggestedSpecs ?? undefined,
                sourceCount: { increment: 1 },
                lastEnrichedAt: new Date(),
              },
            })
          : await this.prisma.canonicalProduct.create({
              data: {
                normalizedName,
                richDescription: object.suggestedDescription,
                specs: object.suggestedSpecs ?? undefined,
              },
            });
        await this.prisma.product.update({
          where: { id: productId },
          data: { canonicalProductId: savedCanonical.id },
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

  // docs/PRD-seller-knowledge-base.md بخش ۹.۲ (دوم، مورد ۵) — فروشنده یک عکس (برچسب کالا یا
  // خودِ کالا) آپلود می‌کند، مدل vision نام/مشخصات/پیش‌نویس توضیح را از روی عکس استخراج می‌کند.
  // هزینه مثل withWebSearch از اعتبار فروشگاه کسر می‌شود (همون CreditUsageKind.PRODUCT_ENRICHMENT،
  // enum جدید لازم نیست). عمداً از CanonicalProduct cache استفاده نمی‌کند — آن لایه بر اساس نام
  // نرمال‌شده‌ی متنی است، نه محتوای عکس، و این دو هم‌خوان‌سازی مطمئنی ندارند.
  async completeProductInfoFromPhoto(
    sellerId: string,
    storeId: string,
    productId: string,
    file: Express.Multer.File,
  ) {
    const store = await this.storeService.getOwned(sellerId, storeId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException(fa.store.productNotFound);
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException(fa.store.imageOnly);
    }
    if (store.creditBalanceToman <= 0) {
      throw new BadRequestException(
        fa.store.insufficientCreditForPhotoEnrichment,
      );
    }

    // docs/PRD-full-agent-engineering-review.md‌وار همون الگوی verifyReceiptAmount
    // (conversation-engine.service.ts) — تنها الگوی تاییدشده‌ی ورودی تصویر به generateObject در
    // این کدبیس: base64 data URL داخل یک پیام role:'user'، نه URL
    const model = defaultModel();
    const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    const commentsHint = await this.commentsHint(productId);
    const visionMessage: UserModelMessage = {
      role: 'user',
      content: [
        { type: 'image', image: dataUrl },
        {
          type: 'text',
          text: `این عکس یک محصول فروشگاه آنلاین ایرانی است (دسته‌بندی فروشگاه: ${
            store.category ?? 'نامشخص'
          }، نام فعلی محصول: ${product.name}). از روی خودِ عکس (برچسب کالا یا ظاهر کالا) این‌ها
را استخراج کن: اگر نام دقیق‌تری از نام فعلی روی عکس دیدی در suggestedName بگذار (وگرنه خالی
بگذار)، مشخصات فنی واقعاً قابل‌مشاهده (جنس/سایز/رنگ/وزن/...) را در suggestedSpecs، و یک توضیح
فروش‌محور فارسی (۲-۴ جمله) در suggestedDescription بنویس. هرگز چیزی که در عکس دیده نمی‌شود حدس
نزن یا اختراع نکن — اگر عکس اطلاعات کمی داشت، فقط همان مقدار کم را برگردان. هرگز قیمت/موجودی
پیشنهاد نده. پاسخ را فقط به‌صورت یک شیء JSON معتبر مطابق اسکیمای داده‌شده برگردان.${commentsHint}`,
        },
      ],
    };

    try {
      const { object: rawObject, usage } = await generateObject({
        model: this.aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(model),
        schema: z.object({
          suggestedName: z.string().optional(),
          suggestedDescription: z.string(),
          suggestedSpecs: z
            .array(z.object({ label: z.string(), value: z.string() }))
            .optional(),
        }),
        messages: [visionMessage],
        experimental_repairText: this.repairStructuredOutput(),
      });

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

      return {
        suggestedName:
          rawObject.suggestedName?.trim().slice(0, 200) || undefined,
        suggestedDescription: rawObject.suggestedDescription
          .trim()
          .slice(0, MAX_SUGGESTED_DESCRIPTION_CHARS),
        suggestedSpecs: clampProductSpecs(rawObject.suggestedSpecs),
      };
    } catch (err) {
      this.logger.error(
        `completeProductInfoFromPhoto failed for product=${productId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۹ (رصد رقبا) — همان ابزار جستجوی
  // وب موجود، اما به‌جای enrich کردن یک محصول خاص، ۲-۳ فروشگاه مشابه آنلاین را پیدا می‌کند و
  // خلاصه‌ی نقاط قوت محتوایی‌شان را برای الهام (نه کپی) نشان می‌دهد. هزینه مثل completeProductInfo
  // با withWebSearch از اعتبار فروشگاه کسر می‌شود؛ چیزی persist نمی‌شود (استاتلس، مثل ai-complete).
  async analyzeCompetitors(sellerId: string, storeId: string) {
    const store = await this.storeService.getOwned(sellerId, storeId);
    if (store.creditBalanceToman <= 0) {
      throw new BadRequestException(fa.store.insufficientCreditForWebSearch);
    }

    const sampleProducts = await this.prisma.product.findMany({
      where: { storeId },
      select: { name: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const model = 'openai/gpt-5.4-mini';
    try {
      const { object: rawObject, usage } = await generateObject({
        model: this.aiProvider.buildClient(
          undefined,
          { supportsStructuredOutputs: true },
          { tools: PRODUCT_ENRICHMENT_WEB_SEARCH_TOOLS, max_tool_calls: 5 },
        )(model),
        schema: z.object({
          competitors: z
            .array(z.object({ name: z.string(), highlight: z.string() }))
            .max(3),
          suggestions: z.array(z.string()).max(6),
        }),
        system: `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. در وب جستجو کن و ۲ تا ۳
فروشگاه آنلاین/صفحه‌ی اینستاگرام مشابه (همان دسته‌بندی) پیدا کن. برای هرکدام در competitors یک
نام کوتاه و یک جمله درباره‌ی نقطه‌قوت محتوایی‌شان بنویس (مثلاً تاکید روی گارانتی، ارسال سریع،
مشخصات فنی کامل، عکس باکیفیت). در suggestions ۳ تا ۶ پیشنهاد عملی و کوتاه بنویس که این فروشگاه
می‌تواند از آن‌ها الهام بگیرد — هرگز نگو «کپی کن»، فقط ایده بده. هرگز اسم بردن از رقبا را توهین‌آمیز
یا تبلیغاتی نکن، فقط توصیف بی‌طرفانه. اگر چیز معناداری پیدا نکردی، competitors را کوتاه‌تر/خالی
برگردان و suggestions را بر اساس دانش عمومی این دسته‌بندی بنویس. پاسخ را فقط به‌صورت یک شیء JSON
معتبر مطابق اسکیمای داده‌شده برگردان.`,
        prompt: `دسته‌بندی فروشگاه: ${store.category ?? 'نامشخص'}
معرفی فروشگاه: ${store.brandIntro ?? '(ثبت نشده)'}
چند نمونه محصول: ${
          sampleProducts.map((p) => p.name).join('، ') ||
          '(هنوز محصولی ثبت نشده)'
        }`,
        experimental_repairText: this.repairStructuredOutput(),
      });

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

      return {
        competitors: rawObject.competitors.slice(0, 3).map((c) => ({
          name: c.name.trim().slice(0, 80),
          highlight: c.highlight.trim().slice(0, 300),
        })),
        suggestions: rawObject.suggestions
          .map((s) => s.trim().slice(0, 200))
          .filter(Boolean)
          .slice(0, 6),
      };
    } catch (err) {
      this.logger.error(
        `analyzeCompetitors failed for store=${storeId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۹ (پروفایل برند عمیق‌تر در
  // آنبوردینگ) — فروشنده یک متن خام/محاوره‌ای درباره‌ی برندش می‌نویسد، AI همان لحظه (بدون
  // جستجوی وب، رایگان مثل generateBasicSuggestions) آن را به یک معرفی کوتاه و حرفه‌ای تبدیل
  // می‌کند. خروجی مستقیم ذخیره نمی‌شود — فرانت با همان PATCH /v2/stores/:id معمولی روی
  // brandIntro apply می‌کند، دقیقاً مثل بقیه‌ی پیشنهادهای AI در این فایل.
  async generateBrandIntroFromText(
    sellerId: string,
    storeId: string,
    rawText: string,
  ) {
    await this.storeService.getOwned(sellerId, storeId);
    const trimmed = rawText.trim().slice(0, 2000);
    if (!trimmed) {
      throw new BadRequestException(fa.store.brandIntroTextRequired);
    }

    const { object } = await generateObject({
      model: this.provider('openai/gpt-5.4-mini'),
      schema: z.object({ brandIntro: z.string() }),
      system: `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. متن خام زیر که فروشنده درباره‌ی
برند/فروشگاهش نوشته را به یک معرفی کوتاه و حرفه‌ای (فارسی، ۱ تا ۳ جمله، لحن صمیمی ولی قابل‌اعتماد)
تبدیل کن. فقط از همان اطلاعاتی که فروشنده داده استفاده کن، چیزی اختراع نکن. پاسخ را فقط به‌صورت
یک شیء JSON معتبر برگردان.`,
      prompt: trimmed,
      experimental_repairText: this.repairStructuredOutput(),
    });

    return { suggestedBrandIntro: object.brandIntro.trim().slice(0, 300) };
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۱ — فروشنده هرچی از یک محصول می‌داند خام/تیکه‌تیکه می‌نویسد، AI همان
  // لحظه (بدون جستجوی وب/بدون کسر اعتبار، عیناً الگوی generateBrandIntroFromText بالا) آن را
  // به یک توضیح محصول تمیز به‌صورت Markdown تبدیل می‌کند. خروجی مستقیم ذخیره نمی‌شود — فرانت
  // با همان PATCH/POST معمولی محصول روی description اعمال می‌کند.
  async generateProductDescriptionFromNotes(
    sellerId: string,
    storeId: string,
    productId: string,
    rawText: string,
  ) {
    await this.storeService.getOwned(sellerId, storeId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException(fa.store.productNotFound);
    }
    const trimmed = rawText.trim().slice(0, 4000);
    if (!trimmed) {
      throw new BadRequestException(fa.store.productNotesRequired);
    }

    const { object } = await generateObject({
      model: this.provider('openai/gpt-5.4-mini'),
      schema: z.object({ description: z.string() }),
      system: `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. یادداشت خام زیر که فروشنده
درباره‌ی محصول «${product.name}» نوشته (ممکن است تیکه‌تیکه و نامرتب باشد) را به یک توضیح محصول
تمیز و خوش‌خوان به‌صورت Markdown فارسی تبدیل کن — پاراگراف کوتاه و در صورت نیاز لیست نقطه‌ای
برای مزایا/مشخصات، بدون heading. فقط از همان اطلاعاتی که فروشنده داده استفاده کن، چیزی اختراع
نکن. لحن فروش‌محور ولی صادقانه باشد. پاسخ را فقط به‌صورت یک شیء JSON معتبر برگردان.`,
      prompt: trimmed,
      experimental_repairText: this.repairStructuredOutput(),
    });

    return { suggestedDescription: object.description.trim().slice(0, 5000) };
  }

  // docs/PRD-product-display-focus-and-variations.md §۴.۱.۱ (فاز ۲) — فروشنده به‌جای تایپ
  // تک‌تک «سایز» و بعد M/L/XL، یک توضیح متنی آزاد می‌نویسد (مثل کپشن اینستاگرام) و AI آن را به
  // گزینه/مقدار ساخت‌یافته تبدیل می‌کند، عیناً الگوی generateProductDescriptionFromNotes بالا
  // (بدون جستجوی وب، بدون کسر اعتبار). خروجی مستقیم ذخیره نمی‌شود — فرانت همان جدول ترکیب‌های
  // فاز ۱ (ProductVariantsEditor) را با این مقادیر به‌صورت چیپ‌های قابل‌ویرایش پیش‌پر می‌کند؛
  // auto-save ممنوع (تصمیم غیرقابل‌مذاکره‌ی §۴.۱.۱).
  async generateProductOptionsFromText(
    sellerId: string,
    storeId: string,
    productId: string,
    rawText: string,
  ): Promise<{
    optionTypes: { name: string; values: string[] }[];
    assumptions: string[];
  }> {
    await this.storeService.getOwned(sellerId, storeId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException(fa.store.productNotFound);
    }
    const trimmed = rawText.trim().slice(0, 2000);
    if (!trimmed) {
      throw new BadRequestException(fa.store.variantOptionsTextRequired);
    }

    const { object } = await generateObject({
      model: this.provider('openai/gpt-5.4-mini'),
      schema: z.object({
        optionTypes: z
          .array(
            z.object({
              name: z.string(),
              values: z.array(z.string()),
            }),
          )
          .max(2),
        assumptions: z.array(z.string()),
      }),
      system: `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. از توضیح متنی آزاد زیر درباره‌ی
محصول «${product.name}» (ممکن است شبیه کپشن اینستاگرام یا تیکه‌تیکه باشد)، گزینه‌های محصول (مثل
سایز، رنگ) و مقادیر هر گزینه را استخراج کن. حداکثر ۲ نوع گزینه (مثلاً «سایز» و «رنگ») برگردان؛
مقادیر هر گزینه را به ترتیب طبیعی (مثلاً سایزها از کوچک به بزرگ) بچین. اگر برای چیزی مجبور به فرض
شدی (مثلاً فاصله‌ی سایزها، یا تعبیر یک کلمه‌ی مبهم)، آن فرض را به‌صورت یک جمله‌ی کوتاه فارسی در
assumptions بنویس. فقط از همان اطلاعاتی که فروشنده داده استفاده کن، گزینه/مقداری که اصلاً اشاره
نشده اختراع نکن. اگر هیچ گزینه‌ای در متن پیدا نشد، optionTypes را آرایه‌ی خالی برگردان. پاسخ را
فقط به‌صورت یک شیء JSON معتبر برگردان.`,
      prompt: trimmed,
      experimental_repairText: this.repairStructuredOutput(),
    });

    return {
      optionTypes: object.optionTypes
        .filter((o) => o.name.trim() && o.values.length > 0)
        .map((o) => ({
          name: o.name.trim().slice(0, 40),
          values: o.values
            .map((v) => v.trim().slice(0, 40))
            .filter(Boolean)
            .slice(0, 30),
        }))
        .slice(0, 2),
      assumptions: object.assumptions
        .map((a) => a.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 5),
    };
  }

  // docs/PRD-admin-product-enrichment-review.md بخش ۲ — نسخه‌ی ادمین‌محور completeProductInfo
  // بالا: بدون sellerId/getOwned (ادمین مالک فروشگاه نیست)، بدون چک/کسر اعتبار فروشنده (این
  // ابتکار از طرف ادمین است، نه درخواست فروشنده — هزینه‌ی عملیاتی پلتفرم است). چرخه‌ی عمر
  // پیش‌نویس (ذخیره/تایید/رد) مسئولیت ProductEnrichmentService است، نه این متد — این متد فقط
  // تولید محتوا را برمی‌گرداند، چیزی persist نمی‌کند.
  async adminGenerateEnrichmentDraft(
    productId: string,
    opts:
      | { source: 'WEB_SEARCH' }
      | { source: 'ADMIN_RESOURCE'; resourceText: string },
  ): Promise<{
    suggestedDescription: string;
    suggestedQuestions: string[];
    suggestedSpecs?: { label: string; value: string }[];
    sourceNote?: string;
  }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { store: true },
    });
    if (!product) throw new NotFoundException(fa.store.productNotFound);
    const commentsHint = await this.commentsHint(productId);

    if (opts.source === 'ADMIN_RESOURCE') {
      const object = await this.generateFromAdminResource(
        product.store,
        product,
        opts.resourceText,
      );
      return {
        suggestedDescription: object.suggestedDescription,
        suggestedQuestions: object.suggestedQuestions.slice(0, 6),
        suggestedSpecs: object.suggestedSpecs,
      };
    }

    const storeId = product.storeId;
    const normalizedName = normalizeProductName(product.name);
    const existing = await this.prisma.canonicalProduct.findFirst({
      where: { normalizedName },
    });
    let freshCanonical: CanonicalProduct | null = null;
    let staleCanonical: CanonicalProduct | null = null;
    if (existing) {
      const isFresh =
        Date.now() - existing.lastEnrichedAt.getTime() < CANONICAL_FRESHNESS_MS;
      if (isFresh) freshCanonical = existing;
      else staleCanonical = existing;
    }

    const model = 'openai/gpt-5.4-mini';
    try {
      if (freshCanonical) {
        const basic = await this.generateBasicSuggestions(
          product.store,
          product,
          commentsHint,
        );
        await this.prisma.canonicalProduct.update({
          where: { id: freshCanonical.id },
          data: { sourceCount: { increment: 1 } },
        });
        if (product.canonicalProductId !== freshCanonical.id) {
          await this.prisma.product.update({
            where: { id: productId },
            data: { canonicalProductId: freshCanonical.id },
          });
        }
        const specs = freshCanonical.specs as
          { label: string; value: string }[] | undefined;
        return {
          suggestedDescription: freshCanonical.richDescription,
          suggestedQuestions: basic.suggestedQuestions.slice(0, 6),
          suggestedSpecs: specs,
          sourceNote:
            'این توضیحات قبلاً برای محصول مشابه در فروشگاه دیگری تایید شده است.',
        };
      }

      const { object: rawObject, usage } = await generateObject({
        model: this.aiProvider.buildClient(
          undefined,
          { supportsStructuredOutputs: true },
          {
            tools: PRODUCT_ENRICHMENT_WEB_SEARCH_TOOLS,
            max_tool_calls: 5,
          },
        )(model),
        schema: z.object({
          suggestedDescription: z.string(),
          suggestedQuestions: z.array(z.string()).min(1),
          suggestedSpecs: z
            .array(z.object({ label: z.string(), value: z.string() }))
            .optional(),
          sourceNote: z.string().optional(),
        }),
        system: `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. نام محصول زیر را در وب جستجو کن
و توضیح/مشخصات واقعی‌اش را پیدا کن. یک توضیح کامل‌تر و فروش‌محورتر (فارسی، ۲-۴ جمله) بنویس،
۴ تا ۶ سؤال رایج که مشتری‌های این‌جور محصول معمولاً می‌پرسند لیست کن، و اگر مشخصات فنی واقعی
(جنس/سایزبندی/...) پیدا کردی در suggestedSpecs بگذار. sourceNote یک جمله‌ی کوتاه بگو از کجا
این اطلاعات آمد. هرگز قیمت/موجودی/کد محصول پیشنهاد نده — این‌ها فقط از فروشنده می‌آیند. این
توضیح ممکن است بین چند فروشگاه مشابه به اشتراک گذاشته شود — هرگز نام فروشگاه، لینک، یا شرایط
ارسال/بازگشت مخصوص یک فروشگاه را در توضیح نیاور، فقط توضیح عمومی خودِ محصول. اگر جستجو چیز
معنی‌داری پیدا نکرد (محصول عمومی/بی‌نام‌تجاری)، به‌جای اطلاعات جعلی یک توضیح عمومی‌تر بده و
sourceNote را خالی بگذار. پاسخ را فقط به‌صورت یک شیء JSON معتبر مطابق اسکیمای داده‌شده برگردان.`,
        prompt: `دسته‌بندی فروشگاه: ${product.store.category ?? 'نامشخص'}
نام محصول: ${product.name}
توضیح فعلی: ${product.description ?? '(هنوز توضیحی ثبت نشده)'}${commentsHint}`,
        experimental_repairText: this.repairStructuredOutput(),
      });
      const object = clampEnrichmentOutput(rawObject);

      // فروشنده هیچ درخواستی نداده و اعتبارش کسر نمی‌شود، ولی هزینه‌ی واقعی همچنان برای
      // دید تحلیلی/آمار هزینه‌ی پلتفرم ثبت می‌شود (storeId فقط برای گزارش‌گیری، نه کسر از کیف‌پول)
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
          isFreeQuota: true,
        },
      });

      const savedCanonical = staleCanonical
        ? await this.prisma.canonicalProduct.update({
            where: { id: staleCanonical.id },
            data: {
              richDescription: object.suggestedDescription,
              specs: object.suggestedSpecs ?? undefined,
              sourceCount: { increment: 1 },
              lastEnrichedAt: new Date(),
            },
          })
        : await this.prisma.canonicalProduct.create({
            data: {
              normalizedName,
              richDescription: object.suggestedDescription,
              specs: object.suggestedSpecs ?? undefined,
            },
          });
      await this.prisma.product.update({
        where: { id: productId },
        data: { canonicalProductId: savedCanonical.id },
      });

      return {
        suggestedDescription: object.suggestedDescription,
        suggestedQuestions: object.suggestedQuestions.slice(0, 6),
        suggestedSpecs: object.suggestedSpecs,
        sourceNote: object.sourceNote,
      };
    } catch (err) {
      this.logger.error(
        `adminGenerateEnrichmentDraft failed for product=${productId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  // docs/PRD-admin-product-enrichment-review.md بخش ۲ — بدون وب‌سرچ، بدون CanonicalProduct
  // (منبع یک‌بارمصرف دستی ادمین است، نه جستجوی پولی تکرارشدنی بین فروشگاه‌ها)
  private async generateFromAdminResource(
    store: { category: string | null },
    product: { name: string; description: string | null },
    resourceText: string,
  ) {
    const { object } = await generateObject({
      model: this.provider('openai/gpt-5.4-mini'),
      schema: z.object({
        suggestedDescription: z.string(),
        suggestedQuestions: z.array(z.string()).min(1),
        suggestedSpecs: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .optional(),
      }),
      system: ADMIN_RESOURCE_SYSTEM_PROMPT,
      prompt: `نام محصول: ${product.name}
دسته‌بندی فروشگاه: ${store.category ?? 'نامشخص'}
توضیح فعلی: ${product.description ?? '(هنوز توضیحی ثبت نشده)'}

--- منبع ارائه‌شده توسط ادمین ---
${resourceText.slice(0, MAX_EXTRACTED_CHARS)}`,
      experimental_repairText: this.repairStructuredOutput(),
    });
    return clampEnrichmentOutput(object);
  }

  // بخش مشترک بین حالت معمولی (withWebSearch=false) و حالت cache-hit بخش ۲.۴ (که description
  // را از CanonicalProduct می‌گیرد ولی هنوز به یک لیست سؤال محتاج است) — رایگان/بدون کسر اعتبار
  private async generateBasicSuggestions(
    store: { category: string | null },
    product: { name: string; description: string | null },
    commentsHint = '',
  ) {
    const { object } = await generateObject({
      model: this.provider('openai/gpt-5.4-mini'),
      schema: z.object({
        suggestedDescription: z.string(),
        suggestedQuestions: z.array(z.string()).min(1),
      }),
      system: BASIC_SUGGESTIONS_SYSTEM_PROMPT,
      prompt: `دسته‌بندی فروشگاه: ${store.category ?? 'نامشخص'}
نام محصول: ${product.name}
توضیح فعلی: ${product.description ?? '(هنوز توضیحی ثبت نشده)'}${commentsHint}`,
      experimental_repairText: this.repairStructuredOutput(),
    });
    return clampEnrichmentOutput(object);
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
          .nullable()
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
      experimental_repairText: this.repairStructuredOutput(),
    });

    return {
      name: object.name.trim(),
      suggestedDescription: object.suggestedDescription
        .trim()
        .slice(0, MAX_SUGGESTED_DESCRIPTION_CHARS),
      suggestedSpecs: clampProductSpecs(object.suggestedSpecs ?? undefined),
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
