import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { embed, cosineSimilarity, generateObject, generateText } from 'ai';
import type { RepairTextFunction, UserModelMessage } from 'ai';
import { z } from 'zod';
import type {
  StoreKbKind,
  CanonicalProduct,
  ContentChangeSource,
} from '@prisma/client';
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
import { ContentChangeLogService } from './content-change-log.service';
import { defaultModel } from '../sales-agent/model-variants';
import { clampProductSpecs } from './product-specs.types';
import { BUSINESS_CATEGORIES } from './business-categories';
import { IRAN_PROVINCES } from '../../common/constants/iran-provinces';
import {
  AnalyzeOwnerNotesDto,
  NotesAnalysisEntityType,
} from './dto/analyze-owner-notes.dto';

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
// فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — پسوندهای صوتی که extractCandidatesFromFile به‌جای parseUploadedKbFile
// (که فقط سند/متن می‌شناسد) به مسیر رونویسی ASR می‌فرستد
const AUDIO_FILE_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'oga',
  'webm',
  'aac',
  'flac',
]);

export interface StoreKbEntryInput {
  kind: StoreKbKind;
  question: string;
  answer: string;
  tags?: string[];
  relatedProductId?: string | null;
  // docs/PRD-seller-guide-assistant-modal.md بخش ۱.۳ — فقط برای لاگ تغییرات محتوا
  source?: ContentChangeSource;
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

// docs/PRD-bulk-product-import-from-document.md — یک ردیف استخراج‌شده از فایل/متن/صوت؛
// همین تایپ در telegram.service.ts هم برای فلوی تلگرام reuse می‌شود
export interface ExtractedProductCandidate {
  action: 'create' | 'update';
  matchedProductId?: string;
  matchedProductName?: string;
  name: string;
  description?: string;
  basePrice?: number;
  stock?: number;
  code?: string;
}

export interface ExtractProductsResult {
  items: ExtractedProductCandidate[];
  assumptions: string[];
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
    private readonly changeLog: ContentChangeLogService,
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

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۵ — ابزارهای AI فروشگاه (notes-analysis/enrichment/web-search) باید
  // دقیقاً مثل credit.service.ts's logUsage بودجه‌ی آزمایشی (trial) را هم اعتبار حساب کنند، نه
  // فقط creditBalanceToman خریداری‌شده — وگرنه فروشگاه تازه‌ساز که هنوز خریدی نکرده با خطای
  // «اعتبار نداری» بلاک می‌شود با وجود trial فعال
  private hasUsableCredit(store: {
    creditBalanceToman: number;
    trialEndsAt: Date | null;
    trialCreditRemainingToman: number;
  }): boolean {
    const trialActive =
      !!store.trialEndsAt &&
      store.trialEndsAt > new Date() &&
      store.trialCreditRemainingToman > 0;
    return store.creditBalanceToman > 0 || trialActive;
  }

  // همون الگوی credit.service.ts's logUsage — اول از بودجه‌ی آزمایشی کم می‌شود (اگر فعال/مثبت)،
  // وگرنه از اعتبار واقعی فروشگاه
  private async decrementStoreCredit(
    storeId: string,
    costToman: number,
  ): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { trialEndsAt: true, trialCreditRemainingToman: true },
    });
    const trialActive =
      !!store?.trialEndsAt &&
      store.trialEndsAt > new Date() &&
      store.trialCreditRemainingToman > 0;
    await this.prisma.store.update({
      where: { id: storeId },
      data: trialActive
        ? { trialCreditRemainingToman: { decrement: costToman } }
        : { creditBalanceToman: { decrement: costToman } },
    });
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
    await this.changeLog.logMany([
      {
        storeId,
        sellerId,
        entityType: 'KB_ENTRY',
        entityId: entry.id,
        fieldName: 'question',
        oldValue: null,
        newValue: entry.question,
        source: input.source,
      },
      {
        storeId,
        sellerId,
        entityType: 'KB_ENTRY',
        entityId: entry.id,
        fieldName: 'answer',
        oldValue: null,
        newValue: entry.answer,
        source: input.source,
      },
    ]);
    return entry;
  }

  async update(
    sellerId: string,
    storeId: string,
    id: string,
    input: StoreKbEntryUpdateInput,
  ) {
    const before = await this.getOwnedEntry(sellerId, storeId, id);
    const { source, ...rest } = input;
    const data: Record<string, unknown> = { ...rest };
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
    await this.changeLog.logMany([
      {
        storeId,
        sellerId,
        entityType: 'KB_ENTRY',
        entityId: id,
        fieldName: 'question',
        oldValue: before.question,
        newValue: entry.question,
        source,
      },
      {
        storeId,
        sellerId,
        entityType: 'KB_ENTRY',
        entityId: id,
        fieldName: 'answer',
        oldValue: before.answer,
        newValue: entry.answer,
        source,
      },
    ]);
    return entry;
  }

  async remove(sellerId: string, storeId: string, id: string) {
    const before = await this.getOwnedEntry(sellerId, storeId, id);
    await this.prisma.storeKbEntry.delete({ where: { id } });
    this.invalidateCache(storeId);
    await this.changeLog.logMany([
      {
        storeId,
        sellerId,
        entityType: 'KB_ENTRY',
        entityId: id,
        fieldName: 'question',
        oldValue: before.question,
        newValue: null,
      },
      {
        storeId,
        sellerId,
        entityType: 'KB_ENTRY',
        entityId: id,
        fieldName: 'answer',
        oldValue: before.answer,
        newValue: null,
      },
    ]);
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

  // هسته‌ی مشترک استخراج کاندید از متن — هم فایل (بعد از extractChatFileText/رونویسی صوت) و
  // هم متن مستقیم پیست‌شده از همین عبور می‌کنند (فیدبک کاربر ۱۴۰۵/۰۷/۱۲)
  private async extractKbCandidatesFromText(
    text: string,
  ): Promise<KbCandidateEntry[]> {
    if (!text.trim()) return [];

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
      system: `از متن زیر (که فروشنده‌ی یک فروشگاه آنلاین داده) چند مورد «سؤال/جواب» یا
«نکته‌ی مهم» برای یک باکس دانش استخراج کن — چیزی که به یک ربات فروش کمک می‌کند به سؤالات
مشتری دقیق‌تر جواب بدهد. هر مورد یک kind مناسب بگیرد:
- FAQ: سؤال متداول با جواب مشخص
- POLICY: شرایط مرجوعی/ارسال/گارانتی
- PRODUCT_INFO: نکته‌ی مربوط به یک محصول خاص
- GENERAL: هرچیز دیگر (معرفی برند، ساعت پاسخ‌گویی، ...)
فقط از متن واقعی استخراج کن، چیزی اضافه نکن. اگر متن هیچ نکته‌ی قابل‌استفاده‌ای نداشت،
آرایه‌ی خالی برگردان.`,
      prompt: text,
      experimental_repairText: this.repairStructuredOutput(),
    });

    return object.candidates;
  }

  // فایل آپلودی را به چند KB entry کاندید می‌شکند — فروشنده باید قبل از ذخیره‌ی هرکدام
  // تأیید/ویرایش کند (human-in-the-loop، طبق بخش ۳.۳ سند: هیچ‌چیز خودکار ذخیره نمی‌شود).
  // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — فایل صوتی هم پذیرفته می‌شود؛ تشخیص بر اساس پسوند است، فروشنده
  // لازم نیست نوع فایل را جدا انتخاب کند («سیستم خودش تشخیص بده»)
  async extractCandidatesFromFile(
    sellerId: string,
    storeId: string,
    file: { buffer: Buffer; originalname: string },
  ): Promise<KbCandidateEntry[]> {
    await this.storeService.getOwned(sellerId, storeId);

    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (AUDIO_FILE_EXTENSIONS.has(ext)) {
      const mp3Buffer = await this.mediaTranscode.extractAudio(
        file.buffer,
        ext,
      );
      const transcript = await this.asr.transcribeWithFallback(
        mp3Buffer,
        this.aiProvider.sharedApiKey,
        'fa',
        undefined,
        VOICE_MESSAGE_ASR_CHAIN,
        false,
      );
      return this.extractKbCandidatesFromText(transcript.text);
    }

    const parsed = parseUploadedKbFile(file.buffer, file.originalname);
    if (!parsed) throw new NotFoundException(fa.storeKb.invalidFile);

    const extracted = await extractChatFileText(parsed, MAX_EXTRACTED_CHARS);
    return this.extractKbCandidatesFromText(extracted.text);
  }

  // همان استخراج بالا برای متن مستقیم پیست‌شده (بدون فایل)
  async extractCandidatesFromText(
    sellerId: string,
    storeId: string,
    rawText: string,
  ): Promise<KbCandidateEntry[]> {
    await this.storeService.getOwned(sellerId, storeId);
    const trimmed = rawText.trim().slice(0, MAX_EXTRACTED_CHARS);
    if (!trimmed) throw new BadRequestException(fa.storeKb.textRequired);
    return this.extractKbCandidatesFromText(trimmed);
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
    if (withWebSearch && !this.hasUsableCredit(store)) {
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
        await this.decrementStoreCredit(storeId, costToman);

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
    if (!this.hasUsableCredit(store)) {
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
      await this.decrementStoreCredit(storeId, costToman);

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
    if (!this.hasUsableCredit(store)) {
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
      await this.decrementStoreCredit(storeId, costToman);

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

  // docs/PRD-ai-assisted-business-setup.md — قدم ۱ ویزارد ثبت‌نام (قبل از ساخت فروشگاه، بدون
  // storeId/getOwned). فروشنده کسب‌وکارش را با زبان خودش توصیف می‌کند یا بیوی اینستاگرامش را
  // پیست می‌کند؛ AI آن را به businessType/category(+یادداشت قیمت‌گذاری در صورت نیاز) نگاشت
  // می‌کند. خروجی هرگز auto-save نیست — فرانت فقط در صورت confidence=HIGH کارت تأیید نشان
  // می‌دهد، وگرنه مستقیم به چیپ‌های دستی (پیش‌پرشده با همین حدس) برمی‌گردد.
  //
  // category حتماً .enum() روی BUSINESS_CATEGORIES است، نه string آزاد — تا AI هیچ‌وقت
  // دسته‌ای خارج از چیپ‌های واقعی ویزارد پیشنهاد ندهد. pricingNote/confidence .nullable()
  // هستند نه .optional() — طبق تجربه‌ی store-kb.service.ts/extractProductCandidatesFromText:
  // با supportsStructuredOutputs=true، OpenAI در strict mode فیلد optional را رد می‌کند.
  async classifyBusinessSetup(rawText: string) {
    const trimmed = rawText.trim().slice(0, 2000);
    if (!trimmed) {
      throw new BadRequestException(fa.store.businessSetupTextRequired);
    }

    const { object } = await generateObject({
      model: this.provider('openai/gpt-5.4-mini'),
      schema: z.object({
        businessType: z.enum(['PRODUCT_SALES', 'APPOINTMENT_BOOKING']),
        confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        category: z.enum(BUSINESS_CATEGORIES),
        businessTypeReason: z.string(),
        categoryReason: z.string(),
        pricingNote: z.string().nullable(),
      }),
      system: `تو دستیار ثبت‌نام یک فروشگاه‌ساز آنلاین ایرانی هستی. فروشنده یک توضیح آزاد درباره‌ی
کسب‌وکارش نوشته (یا بیوی اینستاگرامش را پیست کرده). از روی همین متن سه چیز را تشخیص بده:

۱. businessType: "PRODUCT_SALES" اگر فروشنده کالای فیزیکی با تحویل می‌فروشد، "APPOINTMENT_BOOKING"
اگر صاحب «وقت»/نوبت است (پزشک، مشاور، سالن زیبایی، معلم خصوصی، مربی) نه کالا.
۲. category: دقیقاً یکی از این مقادیر (نه چیز دیگری، حتی اگر نزدیک‌تر به نظر برسد): ${BUSINESS_CATEGORIES.join('، ')}
۳. در صورتی که فروشنده اشاره کرد قیمت ثابت نیست و بر اساس وزن/نرخ روز/فرمول محاسبه می‌شود
(مثل طلا/نقره آب‌شده)، در pricingNote یک جمله‌ی کوتاه و کاربردی به فروشنده بگو که فعلاً این را
در توضیح محصول بنویسد (قیمت‌گذاری خودکار وزن‌محور هنوز اضافه نشده)؛ در غیر این صورت pricingNote
را null بگذار.

نمونه‌ها:
- «طلافروشی‌ام، آب‌شده و دست‌دوم کار می‌کنم، قیمت رو بر اساس وزن و اجرت حساب می‌کنم» →
  businessType=PRODUCT_SALES, category=جواهرات و اکسسوری, pricingNote پر شود.
- «روان‌شناسم، مشاوره‌ی تلفنی و حضوری میدم» → businessType=APPOINTMENT_BOOKING, category=مشاوره,
  pricingNote=null.
- «سالن زیبایی‌مون، من و دو تا همکارم رنگ و کوتاهی کار می‌کنیم» →
  businessType=APPOINTMENT_BOOKING, category=سالن زیبایی و آرایشگاه.
- «پوشاک زنانه می‌فروشم، سایز ۳۶ تا ۴۲» → businessType=PRODUCT_SALES, category=پوشاک.

confidence را محافظه‌کارانه بزن: اگر متن خیلی کوتاه/مبهم بود و نمی‌شود مطمئن حدس زد، LOW یا
MEDIUM بگذار، نه HIGH. businessTypeReason/categoryReason باید خیلی کوتاه باشند (یک جمله‌ی
ساده‌ی فارسی که توضیح بدهد از کدام کلمه/جمله‌ی فروشنده این حدس زده شد). چیزی اختراع نکن، فقط از
همان متن استفاده کن. پاسخ را فقط به‌صورت یک شیء JSON معتبر برگردان.`,
      prompt: trimmed,
      experimental_repairText: this.repairStructuredOutput(),
    });

    return {
      businessType: object.businessType,
      confidence: object.confidence,
      category: object.category,
      businessTypeReason: object.businessTypeReason.trim().slice(0, 200),
      categoryReason: object.categoryReason.trim().slice(0, 200),
      pricingNote: object.pricingNote?.trim().slice(0, 300) || null,
    };
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

  // docs/PRD-seller-guide-assistant-modal.md بخش ۱.۲ — فروشنده خودش در ChatGPT بیرونی با یکی
  // از سه پرامپت آماده کار می‌کند (یا مستقیم یادداشت می‌نویسد) و نتیجه را این‌جا پیست می‌کند.
  // این متن خام هرگز خلاصه نمی‌شود — کامل به ownerNotes مربوطه append می‌شود (append-only)،
  // بعد یک تحلیل جدا (همیشه gpt-6.1-sol ثابت، نه pool A/B خریدار — این یک استخراج
  // ساخت‌یافته است نه مکالمه‌ی آزاد) پیشنهاد می‌دهد این متن به چه فیلدهای دیگری هم می‌خورد.
  // هیچ‌چیز خودکار در فیلد اصلی نمی‌نشیند — فقط پیشنهاد (human-in-the-loop).
  async analyzeOwnerNotes(
    sellerId: string,
    storeId: string,
    dto: AnalyzeOwnerNotesDto,
  ) {
    const store = await this.storeService.getOwned(sellerId, storeId);
    const rawText = dto.rawText?.trim() || undefined;

    let product: {
      id: string;
      name: string;
      ownerNotes: string | null;
    } | null = null;
    if (dto.entityType === NotesAnalysisEntityType.PRODUCT) {
      if (!dto.productId) throw new NotFoundException(fa.store.productNotFound);
      const found = await this.prisma.product.findUnique({
        where: { id: dto.productId },
      });
      if (!found || found.storeId !== storeId) {
        throw new NotFoundException(fa.store.productNotFound);
      }
      product = found;
    }

    const previousNotes =
      dto.entityType === NotesAnalysisEntityType.STORE
        ? store.ownerNotes
        : product!.ownerNotes;

    if (!rawText && !previousNotes) {
      throw new BadRequestException(fa.store.notesAnalysisTextRequired);
    }
    if (!this.hasUsableCredit(store)) {
      throw new BadRequestException(
        fa.store.insufficientCreditForNotesAnalysis,
      );
    }

    const updatedNotes = rawText
      ? previousNotes
        ? `${previousNotes}\n\n---\n${new Date().toISOString().slice(0, 10)}:\n${rawText}`
        : rawText
      : (previousNotes ?? '');

    if (rawText) {
      if (dto.entityType === NotesAnalysisEntityType.STORE) {
        await this.prisma.store.update({
          where: { id: storeId },
          data: { ownerNotes: updatedNotes },
        });
        await this.changeLog.logFieldChange({
          storeId,
          sellerId,
          entityType: 'STORE',
          entityId: null,
          fieldName: 'ownerNotes',
          oldValue: previousNotes,
          newValue: updatedNotes,
        });
      } else {
        await this.prisma.product.update({
          where: { id: product!.id },
          data: { ownerNotes: updatedNotes },
        });
        await this.changeLog.logFieldChange({
          storeId,
          sellerId,
          entityType: 'PRODUCT',
          entityId: product!.id,
          fieldName: 'ownerNotes',
          oldValue: previousNotes,
          newValue: updatedNotes,
        });
      }
    }

    const model = 'openai/gpt-6.1-sol';
    const kbCandidateSchema = z.array(
      z.object({
        question: z.string(),
        answer: z.string(),
        kind: z.enum(['FAQ', 'POLICY', 'PRODUCT_INFO', 'GENERAL']),
        tags: z.array(z.string()),
      }),
    );

    if (dto.entityType === NotesAnalysisEntityType.STORE) {
      const { object, usage } = await generateObject({
        model: this.provider(model),
        schema: z.object({
          brandIntroSuggestion: z.string().nullable(),
          shippingInfoSuggestion: z.string().nullable(),
          returnPolicySuggestion: z.string().nullable(),
          categoryHint: z.enum(BUSINESS_CATEGORIES).nullable(),
          shippingRuleSuggestions: z.array(
            z.object({
              provinces: z.array(z.string()),
              cost: z.number().int().min(0),
            }),
          ),
          kbCandidates: kbCandidateSchema,
        }),
        system: `تو دستیار تحلیل یادداشت فروشنده‌ی یک فروشگاه آنلاین ایرانی هستی. یادداشت خام
زیر شامل هرچیزی است که فروشنده تا امروز درباره‌ی فروشگاهش نوشته (ممکن است از قبل جواب‌هایی که
از ChatGPT گرفته هم داخلش باشد). کارت:
۱. اگر متن شامل معرفی/داستان برند بود، یک brandIntroSuggestion کوتاه (۱-۳ جمله فارسی) بنویس؛
وگرنه null.
۲. اگر متن شامل جزئیات ارسال (زمان/هزینه/نحوه) بود، یک shippingInfoSuggestion بنویس؛ وگرنه null.
۲ب. اگر متن هزینه‌ی ارسال را به تفکیک شهر/استان مشخص کرد (مثلاً «تهران رایگان، اصفهان ۱۰۰
هزار تومان»)، همین را علاوه بر shippingInfoSuggestion، ساخت‌یافته هم در shippingRuleSuggestions
بده: هر آیتم {provinces, cost}. provinces باید دقیقاً نام استان از این فهرست بسته باشد (نه
شهر، نه چیز دیگر): ${IRAN_PROVINCES.join('، ')}. اگر فروشنده نام شهر گفت، به استان متناظرش
نگاشت کن (مثلاً مشهد→خراسان رضوی، شیراز→فارس، تبریز→آذربایجان شرقی، تهران→تهران، اصفهان→اصفهان).
اگر یک نرخ برای «بقیه‌ی شهرها»/«سراسر ایران» گفت، آن را با provinces خالی ([]) به‌عنوان نرخ
پیش‌فرض بده (حداکثر یک آیتم با provinces خالی). اگر متن هزینه‌ی ارسال به تفکیک مکان نداشت،
shippingRuleSuggestions را آرایه‌ی خالی برگردان — هزینه‌ای که فروشنده نگفته حدس نزن.
۳. اگر متن شامل شرایط مرجوعی/گارانتی بود، یک returnPolicySuggestion بنویس؛ وگرنه null.
۴. categoryHint: اگر از متن می‌شود نوع کسب‌وکار را فهمید، دقیقاً یکی از این مقادیر را برگردان
(نه چیز دیگری): ${BUSINESS_CATEGORIES.join('، ')} — وگرنه null.
۵. kbCandidates: هر نکته‌ی مجزا که برای ۱ تا ۴ بالا استفاده نشد ولی ارزش ثبت در باکس دانش
فروشگاه را دارد (سؤال رایج مشتری=FAQ، سیاست دیگر=POLICY، نکته‌ی یک محصول خاص=PRODUCT_INFO،
هرچیز دیگر=GENERAL). حداکثر ۱۰ مورد.
قانون مهم: هیچ جزئیاتی که فروشنده گفته را حذف/خلاصه نکن — اگر چیزی برای یک فیلد زیاد است، آن
را به‌جای چپاندن در همان فیلد، در kbCandidates بگذار. چیزی که فروشنده نگفته اختراع نکن. هر
suggestion که تکرار محض چیزی است که از قبل در فیلد مقصد هست را دوباره پیشنهاد نده. پاسخ را
فقط به‌صورت یک شیء JSON معتبر برگردان.`,
        prompt: `دسته‌بندی فعلی فروشگاه: ${store.category ?? 'نامشخص'}
یادداشت کامل فروشنده:
${updatedNotes}`,
        experimental_repairText: this.repairStructuredOutput(),
      });

      await this.logNotesAnalysisCost(storeId, model, usage);

      let sawNationwideShippingRule = false;
      const shippingRuleSuggestions = object.shippingRuleSuggestions
        .map((r) => ({
          provinces: Array.from(
            new Set(r.provinces.filter((p) => IRAN_PROVINCES.includes(p))),
          ),
          cost: Math.max(0, Math.round(r.cost)),
        }))
        .filter((r) => {
          if (r.provinces.length === 0) {
            if (sawNationwideShippingRule) return false;
            sawNationwideShippingRule = true;
          }
          return true;
        })
        .slice(0, 10);

      return {
        ownerNotes: updatedNotes,
        brandIntroSuggestion:
          object.brandIntroSuggestion?.trim().slice(0, 300) || null,
        shippingInfoSuggestion:
          object.shippingInfoSuggestion?.trim().slice(0, 1000) || null,
        returnPolicySuggestion:
          object.returnPolicySuggestion?.trim().slice(0, 1000) || null,
        categoryHint: object.categoryHint,
        shippingRuleSuggestions,
        kbCandidates: object.kbCandidates.slice(0, 10).map((c) => ({
          question: c.question.trim().slice(0, 500),
          answer: c.answer.trim().slice(0, 5000),
          kind: c.kind,
          tags: c.tags.slice(0, 5),
        })),
      };
    }

    const { object, usage } = await generateObject({
      model: this.provider(model),
      schema: z.object({
        descriptionSuggestion: z.string().nullable(),
        specsSuggestion: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .nullable(),
        kbCandidates: kbCandidateSchema,
      }),
      system: `تو دستیار تحلیل یادداشت فروشنده درباره‌ی محصول «${product!.name}» در یک فروشگاه
آنلاین ایرانی هستی. یادداشت خام زیر شامل هرچیزی است که فروشنده تا امروز درباره‌ی این محصول
نوشته. کارت:
۱. descriptionSuggestion: یک توضیح محصول کامل و فروش‌محور (Markdown فارسی) که تمام جزئیات
یادداشت را عیناً منعکس کند — خلاصه‌کردن/حذف‌کردن جزئیات (رنگ/سایز/جنس/نکته‌ی خاص) ممنوع است،
حتی اگر متن طولانی شود. اگر یادداشت چیزی برای توضیح ندارد، null.
۲. specsSuggestion: مشخصات فنی ساخت‌یافته (مثل جنس/سایزبندی) به‌صورت {label, value}؛ وگرنه null.
۳. kbCandidates: سؤالاتی که مشتری درباره‌ی همین محصول می‌پرسد (kind باید FAQ یا PRODUCT_INFO
باشد)، حداکثر ۶ مورد.
قیمت/موجودی/کد محصول را هرگز پیشنهاد نده. چیزی که فروشنده نگفته اختراع نکن. پاسخ را فقط
به‌صورت یک شیء JSON معتبر برگردان.`,
      prompt: updatedNotes,
      experimental_repairText: this.repairStructuredOutput(),
    });

    await this.logNotesAnalysisCost(storeId, model, usage);

    return {
      ownerNotes: updatedNotes,
      descriptionSuggestion:
        object.descriptionSuggestion?.trim().slice(0, 5000) || null,
      specsSuggestion: object.specsSuggestion
        ? (clampProductSpecs(object.specsSuggestion) ?? null)
        : null,
      kbCandidates: object.kbCandidates.slice(0, 6).map((c) => ({
        question: c.question.trim().slice(0, 500),
        answer: c.answer.trim().slice(0, 5000),
        kind: c.kind,
        tags: c.tags.slice(0, 5),
      })),
    };
  }

  private async logNotesAnalysisCost(
    storeId: string,
    model: string,
    usage: { inputTokens?: number; outputTokens?: number },
  ) {
    const { costToman } = await this.pricing.calcCost(
      usage.inputTokens ?? 0,
      usage.outputTokens ?? 0,
      model,
    );
    await this.prisma.creditUsageEvent.create({
      data: {
        storeId,
        model,
        kind: 'NOTES_ANALYSIS',
        costToman,
        isFreeQuota: false,
      },
    });
    await this.decrementStoreCredit(storeId, costToman);
  }

  // docs/PRD-bulk-product-import-from-document.md — فروشنده یک متن بلند/فایل (PDF/Word) یا
  // رونویسی صوت را می‌دهد که چند محصول را با هم توصیف می‌کند؛ از آن یک آرایه‌ی محصول استخراج
  // می‌شود و هرکدام با محصولات موجود فروشگاه (با کد، بعد اسم) تطبیق داده می‌شود تا فروشنده در
  // شیت مرور بداند کدام «ایجاد» و کدام «آپدیتِ» کدام محصول است. تطبیق قطعی/دترمینیستیک است
  // (نه حدس AI) تا رفتار قابل‌پیش‌بینی بماند. خروجی مستقیم ذخیره نمی‌شود — فرانت با همان
  // useCreateProduct/useUpdateProduct معمولی، فقط بعد از تأیید تک‌تک ردیف‌ها توسط فروشنده،
  // اعمال می‌کند (عیناً اصل غیرقابل‌مذاکره‌ی «AI فقط پیش‌پر می‌کند»، مثل generateProductOptionsFromText بالا).
  private async extractProductCandidatesFromText(
    storeId: string,
    text: string,
  ): Promise<ExtractProductsResult> {
    const { object } = await generateObject({
      model: this.provider('openai/gpt-5.4-mini'),
      // code/description/basePrice/stock عمداً .nullable() هستند نه .optional() — طبق
      // تجربه‌ی nivo-cal.service.ts (fiberG/sugarG)، با OpenAI structured outputs در strict
      // mode، فیلد optional در schema باعث خطای واقعی پروداکشن می‌شود: «'required' is required
      // to... Missing 'code'» (چون strict mode همه‌ی propertyها را در required می‌خواهد، نه فقط
      // فیلدهای اجباری) — این دقیقاً همان ارور بود که با بات تلگرام/آپلود فایل گرفته شد
      // (۱۴۰۵/۰۷/۱۳). optional chaining پایین‌تر (i.code?.trim()) با null هم درست کار می‌کند،
      // پس نیازی به تغییر بقیه‌ی کد نیست.
      schema: z.object({
        items: z
          .array(
            z.object({
              name: z.string(),
              code: z.string().nullable(),
              description: z.string().nullable(),
              basePrice: z.number().nullable(),
              stock: z.number().nullable(),
            }),
          )
          .max(50),
        assumptions: z.array(z.string()),
      }),
      system: `تو دستیار یک فروشنده‌ی فروشگاه آنلاین ایرانی هستی. متن زیر (که ممکن است کپشن
اینستاگرام، کاتالوگ، یا رونویسی صوت فروشنده باشد) توضیح چند محصول مختلف را با هم دارد. برای هر
محصولی که در متن پیدا می‌کنی یک مورد جدا در items برگردان: name (اسم محصول)، description (توضیح
کوتاه، اگر چیزی گفته شده)، basePrice (قیمت به تومان، فقط اگر صریح گفته شده — حدس نزن)، stock
(موجودی، فقط اگر صریح گفته شده)، code (کد/SKU محصول، فقط اگر صریح در متن آمده). هرگز قیمت یا
موجودی را از روی حدس یا میانگین بازار اختراع نکن — اگر گفته نشده، آن فیلد را کلاً نیاور. اگر برای
چیزی مجبور به فرض شدی (مثلاً تفسیر یک کلمه‌ی مبهم)، آن فرض را به‌صورت یک جمله‌ی کوتاه فارسی در
assumptions بنویس. اگر متن هیچ محصول قابل‌تشخیصی نداشت، items را آرایه‌ی خالی برگردان. پاسخ را
فقط به‌صورت یک شیء JSON معتبر برگردان.`,
      prompt: text,
      experimental_repairText: this.repairStructuredOutput(),
    });

    const existing = await this.prisma.product.findMany({
      where: { storeId },
      select: { id: true, name: true, code: true },
    });
    const normalize = (s: string) => s.trim().toLowerCase();
    const byCode = new Map(
      existing.filter((p) => p.code).map((p) => [normalize(p.code!), p]),
    );
    const byName = new Map(existing.map((p) => [normalize(p.name), p]));

    const items = object.items
      .filter((i) => i.name.trim())
      .slice(0, 50)
      .map((i) => {
        const code = i.code?.trim().slice(0, 40) || undefined;
        const matched =
          (code && byCode.get(normalize(code))) ||
          byName.get(normalize(i.name.trim()));
        return {
          action: (matched ? 'update' : 'create') as 'create' | 'update',
          matchedProductId: matched?.id,
          matchedProductName: matched?.name,
          name: i.name.trim().slice(0, 200),
          description: i.description?.trim().slice(0, 5000) || undefined,
          basePrice:
            typeof i.basePrice === 'number' && i.basePrice >= 0
              ? Math.round(i.basePrice)
              : undefined,
          stock:
            typeof i.stock === 'number' && i.stock >= 0
              ? Math.round(i.stock)
              : undefined,
          code,
        };
      });

    return {
      items,
      assumptions: object.assumptions
        .map((a) => a.trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 5),
    };
  }

  async extractProductsFromText(
    sellerId: string,
    storeId: string,
    rawText: string,
  ) {
    await this.storeService.getOwned(sellerId, storeId);
    const trimmed = rawText.trim().slice(0, 8000);
    if (!trimmed) {
      throw new BadRequestException(fa.store.bulkImportTextRequired);
    }
    return this.extractProductCandidatesFromText(storeId, trimmed);
  }

  async extractProductsFromFile(
    sellerId: string,
    storeId: string,
    file: { buffer: Buffer; originalname: string },
  ) {
    await this.storeService.getOwned(sellerId, storeId);

    const parsed = parseUploadedKbFile(file.buffer, file.originalname);
    if (!parsed) throw new NotFoundException(fa.storeKb.invalidFile);

    const extracted = await extractChatFileText(parsed, MAX_EXTRACTED_CHARS);
    if (!extracted.text.trim()) return { items: [], assumptions: [] };

    return this.extractProductCandidatesFromText(storeId, extracted.text);
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
