import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { OrderStatus, GoldWageType } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as XLSX from 'xlsx';
import { randomBytes } from 'crypto';
import { generateObject } from 'ai';
import { z } from 'zod';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { defaultModel } from '../sales-agent/model-variants';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';
import { CreateStoreDto } from './dto/create-store.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ReplaceProductVariantsDto } from './dto/replace-product-variants.dto';
import { UpdateStoreDto } from './dto/update-store.dto';
import { fa } from '../../i18n/fa';
import { computeConversationStats } from '../sales-agent/conversation-stats.util';
import { TelegramApiClientService } from '../telegram/telegram-api-client.service';
import { computeProductCompleteness } from './product-completeness.util';
import { generateShortCode } from '../../common/utils/generate-code';
import {
  parseProductVideos,
  type ProductVideoItem,
} from './product-video.types';
import { clampProductSpecs } from './product-specs.types';
import { ContentChangeLogService } from './content-change-log.service';
import { getSalesAgentGlobalConfig } from '../sales-agent/sales-agent-global-config.util';
import { MarketPricesService } from '../market-prices/market-prices.service';
import { CommentsService } from '../comments/comments.service';
import {
  computeDisplayPrice,
  GoldPriceUnavailableError,
  GoldPricingNotConfiguredError,
} from './product-pricing.util';

// docs/PRD-product-strategy-and-roadmap.md بخش ۳.۱ — چک‌لیست سطح فروشگاه
const MIN_STORE_KB_ENTRIES = 3;

// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۳.۳ — کش aggregator پیشنهاد
// تکمیل پروفایل: ۲۴ ساعت بین دو فراخوان LLM کافی است (این داده به‌کندی تغییر می‌کند)
const ATTENTION_SUGGESTIONS_TTL_MS = 24 * 60 * 60 * 1000;
const ATTENTION_SUGGESTIONS_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
// کمتر از این تعداد مورد گیرکردن/درخواست انسان، خوشه‌بندی معنادار نیست — حدس تک‌موردی به
// فروشنده نشان داده نمی‌شود
const MIN_STUCK_EVENTS_FOR_SUMMARY = 3;

export interface AttentionSuggestionTopic {
  topic: string;
  field:
    | 'brandIntro'
    | 'returnPolicy'
    | 'shippingInfo'
    | 'ownerNotes'
    | 'workingHours'
    | 'other';
  summary: string;
  occurrences: number;
}

// docs/PRD-telegram-bot-channel.md بخش ۹.۱ — عمر لینک اتصال تلگرام فروشنده، یک‌بارمصرف
const TELEGRAM_CONNECT_TOKEN_TTL_MS = 15 * 60 * 1000;

// هدرهای پذیرفته‌شده‌ی آپلود اکسل محصول (گام ۳) — هم فارسی (چیزی که فروشنده واقعاً می‌نویسد)
// هم انگلیسی را می‌پذیرد. ستون «توضیح» اختیاری است (بخش ۹.۲ PRD-seller-knowledge-base.md،
// مورد ۷) — additive، اگر فروشنده این ستون را نداشته باشد مثل قبل نادیده گرفته می‌شود
const PRODUCT_IMPORT_COLUMNS: Record<
  string,
  'name' | 'basePrice' | 'stock' | 'description'
> = {
  نام: 'name',
  name: 'name',
  قیمت: 'basePrice',
  baseprice: 'basePrice',
  price: 'basePrice',
  موجودی: 'stock',
  stock: 'stock',
  توضیح: 'description',
  توضیحات: 'description',
  description: 'description',
};

function cellToString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim();
}

function cellToNumber(value: unknown): number | undefined {
  const s = cellToString(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

// همون الگوی usage-analytics.service.ts's csvEscape — خروجی گزارش فروشنده (بخش ۱.۲)
function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly telegramApi: TelegramApiClientService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly changeLog: ContentChangeLogService,
    private readonly marketPrices: MarketPricesService,
    private readonly aiProvider: AiProviderService,
    private readonly comments: CommentsService,
  ) {}

  list(sellerId: string) {
    return this.prisma.store.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: { products: true },
    });
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    const existing = await this.prisma.store.findUnique({ where: { slug } });
    return !existing;
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۵ — بودجه‌ی آزمایشی (trial) قبلاً فقط لحظه‌ی اولین چتِ خریدار گرنت
  // می‌شد (credit.service.ts's grantTrialIfFirstChat)، یعنی توی onboarding (قبل از هر خریداری)
  // فروشگاه هیچ اعتباری نداشت و ابزارهای AI (راهنما/enrichment) بلافاصله خطای «اعتبار نداری»
  // می‌دادند. حالا همان‌جا گرنت می‌شود؛ grantTrialIfFirstChat دست‌نخورده می‌ماند (guard
  // trialStartedAt آن از این به بعد روی فروشگاه‌های جدید no-op است، برای فروشگاه‌های قدیمی‌تر
  // که از قبل trial نگرفته‌اند همچنان کار می‌کند)
  async create(sellerId: string, dto: CreateStoreDto) {
    if (!(await this.isSlugAvailable(dto.slug))) {
      throw new ConflictException(fa.store.slugTaken);
    }
    const config = await getSalesAgentGlobalConfig(this.prisma);
    const now = new Date();
    const trialEndsAt = new Date(
      now.getTime() + config.trialDurationDays * 24 * 60 * 60 * 1000,
    );
    return this.prisma.store.create({
      data: {
        ...dto,
        sellerId,
        trialStartedAt: now,
        trialEndsAt,
        trialCreditRemainingToman: config.trialCreditToman,
      },
    });
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — فیلدهای ساختاریافته (ارسال/مرجوعی/
  // معرفی برند/ساعت پاسخ‌گویی)؛ برخلاف create، این‌ها بعد از ثبت‌نام هم قابل ویرایش‌اند
  async update(sellerId: string, storeId: string, dto: UpdateStoreDto) {
    const before = await this.getOwned(sellerId, storeId);
    const { source, ...data } = dto;
    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data,
    });
    // docs/PRD-seller-guide-assistant-modal.md بخش ۱.۳ — فقط فیلدهای متنی/توصیفی تراکینگ می‌شوند
    await this.changeLog.logMany(
      (
        [
          'category',
          'brandIntro',
          'shippingInfo',
          'returnPolicy',
          'ownerNotes',
        ] as const
      )
        .filter((f) => data[f] !== undefined && data[f] !== before[f])
        .map((f) => ({
          storeId,
          sellerId,
          entityType: 'STORE' as const,
          entityId: null,
          fieldName: f,
          oldValue: before[f] ?? null,
          newValue: (data[f] as string) ?? null,
          source,
        })),
    );
    return updated;
  }

  // مالکیت را چک می‌کند (۴۰۴/۴۰۳ مناسب پرتاب می‌کند) — الگوی ProjectsService.get
  async getOwned(sellerId: string, storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store) throw new NotFoundException(fa.store.notFound);
    if (store.sellerId !== sellerId)
      throw new ForbiddenException(fa.store.forbidden);
    return store;
  }

  async createProduct(
    sellerId: string,
    storeId: string,
    dto: CreateProductDto,
  ) {
    await this.getOwned(sellerId, storeId);
    if (dto.code) await this.assertProductCodeAvailable(storeId, dto.code);
    this.assertGoldPricingFieldsValid(
      dto.pricingModel,
      dto.weightGrams,
      dto.purityKarat,
      dto.goldWageType,
      dto.goldWageValue,
      dto.goldProfitPercent,
    );
    // عیناً الگوی updateProduct پایین‌تر — specs یک فیلد Prisma.Json است، null خام قابل‌پاس
    // به create نیست (باید Prisma.DbNull باشد)
    const { specs: rawSpecs, ...rest } = dto;
    const specs = clampProductSpecs(rawSpecs ?? undefined) ?? Prisma.DbNull;
    return this.prisma.product.create({
      data: { ...rest, specs, storeId },
    });
  }

  // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۳.۲ — پیش‌نمایش زنده‌ی
  // فرم (نه یک محصول واقعی DB)؛ همان computeDisplayPrice، فقط روی basePrice=0 موقت
  async previewGoldPrice(
    sellerId: string,
    storeId: string,
    weightGrams: number,
    purityKarat: number,
    // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲.۲ — فروشنده حین
    // تایپ ممکن است اجرت/سود اختصاصی این محصول را هم هم‌زمان پر کند؛ پیش‌نمایش باید همان
    // مقادیر در-حال-تایپ را منعکس کند، نه فقط پیش‌فرض ذخیره‌شده‌ی فروشگاه
    productGoldWageType?: GoldWageType,
    productGoldWageValue?: number,
    productGoldProfitPercent?: number,
  ): Promise<{ price: number | null; error: string | null }> {
    const store = await this.getOwned(sellerId, storeId);
    if (!weightGrams || !purityKarat) {
      return { price: null, error: null };
    }
    try {
      const goldItems = (await this.marketPrices.getGoldPrices()).items;
      const price = computeDisplayPrice(
        {
          pricingModel: 'WEIGHT_BASED_FORMULA',
          basePrice: 0,
          weightGrams,
          purityKarat,
          goldWageType: productGoldWageType,
          goldWageValue: productGoldWageValue,
          goldProfitPercent: productGoldProfitPercent,
        },
        null,
        store,
        goldItems,
      );
      return { price, error: null };
    } catch (err) {
      if (err instanceof GoldPricingNotConfiguredError) {
        return { price: null, error: fa.store.goldPricingNotConfigured };
      }
      if (err instanceof GoldPriceUnavailableError) {
        return { price: null, error: fa.store.goldPriceUnavailable };
      }
      throw err;
    }
  }

  // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲/۳ — وقتی
  // pricingModel=WEIGHT_BASED_FORMULA انتخاب شده، وزن و عیار باید صریح ست شده باشند؛ نمی‌شود
  // این را در DTO با decorator ساده بیان کرد چون شرطی به یک فیلد دیگر است
  private assertGoldPricingFieldsValid(
    pricingModel: CreateProductDto['pricingModel'],
    weightGrams: number | undefined,
    purityKarat: number | undefined,
    goldWageType?: GoldWageType | null,
    goldWageValue?: number | null,
    goldProfitPercent?: number | null,
  ): void {
    if (pricingModel !== 'WEIGHT_BASED_FORMULA') return;
    if (!weightGrams || !purityKarat) {
      throw new BadRequestException(fa.store.goldPricingFieldsRequired);
    }
    // فیدبک کاربر ۱۴۰۵/۰۷/۱۴ — اجرت/سود اختصاصی این محصول یا هر سه باید ست شوند یا هیچ‌کدام
    // (یعنی برگشت کامل به پیش‌فرض فروشگاه)؛ یک مقدار تنها بدون بقیه معنی ندارد
    const provided = [goldWageType, goldWageValue, goldProfitPercent].filter(
      (v) => v != null,
    );
    if (provided.length > 0 && provided.length < 3) {
      throw new BadRequestException(fa.store.goldPricingOverridePartial);
    }
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۳ — کد کوتاه یکتا فقط در سطح فروشگاه
  private async assertProductCodeAvailable(
    storeId: string,
    code: string,
    excludeProductId?: string,
  ): Promise<void> {
    // insensitive تا با جستجوی runtime در searchProducts هم‌خوان بماند — وگرنه «A12» و
    // «a12» هر دو قابل ثبت می‌شدند ولی موقع جستجو مبهم بودند
    const existing = await this.prisma.product.findFirst({
      where: {
        storeId,
        code: { equals: code, mode: 'insensitive' },
        ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
      },
    });
    if (existing) throw new ConflictException(fa.store.productCodeTaken);
  }

  // docs/PRD-sales-agent-admin-analytics.md بخش ۴ — نسخه‌ی کوچک همین آمار برای خودِ فروشنده
  // (بدون فیلتر مدل، فقط مقایسه‌ی وب در برابر تلگرام برای همین فروشگاه)
  async getChannelStats(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    return computeConversationStats(this.prisma, {
      storeId,
      groupBy: 'channel',
    });
  }

  async listProducts(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    const products = await this.prisma.product.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      include: {
        // docs/PRD-product-display-focus-and-variations.md §۴.۱ — پنل فروشنده جدول ترکیب‌ها
        // را از همین لیست پر می‌کند (نه یک GET جدا)، عیناً مثل completeness پایین
        optionTypes: {
          orderBy: { position: 'asc' },
          include: { values: { orderBy: { position: 'asc' } } },
        },
        variants: true,
      },
    });
    const kbCountByProduct = await this.relatedKbEntryCounts(storeId);
    return products.map((product) => ({
      ...product,
      completeness: computeProductCompleteness(
        {
          ...product,
          hasVariants: product.optionTypes.length > 0,
          hasZeroStockVariants:
            product.optionTypes.length > 0 &&
            product.variants.every((v) => v.stock === 0),
        },
        kbCountByProduct.get(product.id) ?? 0,
      ),
    }));
  }

  // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۵ — حالت «فروشگاه» خریدار؛ بدون auth (عیناً
  // الگوی startChat در sales-agent.service.ts)، فقط فیلدهای نمایشی ایمن (نه code/telegramShortCode
  // و بقیه‌ی فیلدهای داخلی که listProducts بالا برای پنل فروشنده برمی‌گرداند)
  async listPublicProducts(
    slug: string,
    opts: { q?: string; page: number; pageSize: number },
  ) {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store || store.status !== 'ACTIVE')
      throw new NotFoundException(fa.store.notFound);

    const where: Prisma.ProductWhereInput = {
      storeId: store.id,
      ...(opts.q ? { name: { contains: opts.q, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        select: {
          id: true,
          name: true,
          basePrice: true,
          stock: true,
          images: true,
          videos: true,
          description: true,
          pricingModel: true,
          weightGrams: true,
          purityKarat: true,
          goldWageType: true,
          goldWageValue: true,
          goldProfitPercent: true,
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲.۳/۴.۱ — قیمت محصولات
    // WEIGHT_BASED_FORMULA هیچ‌وقت از basePrice خوانده نمی‌شود، همیشه at-request-time محاسبه
    // می‌شود. فقط اگر حداقل یک محصول این مدل را دارد نرخ طلا را می‌گیریم (fetch رایگان است،
    // از کش Redis می‌آید، ولی بی‌دلیل برای فروشگاه‌های بدون محصول طلا صدا زده نشود)
    const hasGoldProducts = items.some(
      (p) => p.pricingModel === 'WEIGHT_BASED_FORMULA',
    );
    const goldItems = hasGoldProducts
      ? (await this.marketPrices.getGoldPrices()).items
      : [];

    return {
      items: items.map((p) => {
        const {
          pricingModel,
          weightGrams,
          purityKarat,
          goldWageType,
          goldWageValue,
          goldProfitPercent,
          ...publicFields
        } = p;
        let displayPrice = p.basePrice;
        let priceUnavailable = false;
        if (pricingModel === 'WEIGHT_BASED_FORMULA') {
          try {
            displayPrice = computeDisplayPrice(
              {
                pricingModel,
                basePrice: p.basePrice,
                weightGrams,
                purityKarat,
                goldWageType,
                goldWageValue,
                goldProfitPercent,
              },
              null,
              store,
              goldItems,
            );
          } catch (err) {
            if (
              err instanceof GoldPriceUnavailableError ||
              err instanceof GoldPricingNotConfiguredError
            ) {
              priceUnavailable = true;
            } else throw err;
          }
        }
        return {
          ...publicFields,
          videos: parseProductVideos(p.videos),
          isWeightBasedPricing: pricingModel === 'WEIGHT_BASED_FORMULA',
          weightGrams,
          purityKarat,
          basePrice: displayPrice,
          priceUnavailable,
        };
      }),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
    };
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۴.۲ — «مشاهده نظرات
  // خریداران قبلی» در چت خریدار؛ عمداً از روی slug (مثل listPublicProducts بالا) نه storeId،
  // چون این endpoint هم بدون session-token/auth است
  async getApprovedProductReviews(slug: string, productId: string) {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store || store.status !== 'ACTIVE')
      throw new NotFoundException(fa.store.notFound);
    return this.comments.getApprovedForProductWithMedia(productId, store.id);
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۱ — یک groupBy به‌جای N کوئری جدا به‌ازای
  // هر محصول (N+1)
  private async relatedKbEntryCounts(
    storeId: string,
  ): Promise<Map<string, number>> {
    const counts = await this.prisma.storeKbEntry.groupBy({
      by: ['relatedProductId'],
      where: { storeId, isActive: true, relatedProductId: { not: null } },
      _count: { _all: true },
    });
    return new Map(
      counts.map((c) => [c.relatedProductId as string, c._count._all]),
    );
  }

  // امتیاز کلی فروشگاه (میانگین امتیاز محصولات) + چک‌لیست سه‌موردی صفحه‌ی خانه‌ی پنل
  async getCompleteness(sellerId: string, storeId: string) {
    const store = await this.getOwned(sellerId, storeId);
    const products = await this.prisma.product.findMany({
      where: { storeId },
      select: {
        id: true,
        images: true,
        description: true,
        optionTypes: { select: { id: true } },
        variants: { select: { stock: true } },
      },
    });
    const kbCountByProduct = await this.relatedKbEntryCounts(storeId);
    const scores = products.map(
      (p) =>
        computeProductCompleteness(
          {
            ...p,
            hasVariants: p.optionTypes.length > 0,
            hasZeroStockVariants:
              p.optionTypes.length > 0 &&
              p.variants.every((v) => v.stock === 0),
          },
          kbCountByProduct.get(p.id) ?? 0,
        ).percent,
    );
    const overallScorePercent =
      scores.length === 0
        ? 0
        : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const totalKbEntries = await this.prisma.storeKbEntry.count({
      where: { storeId, isActive: true },
    });

    return {
      overallScorePercent,
      checklist: {
        hasProductWithPhoto: products.some((p) => p.images.length > 0),
        hasEnoughKbEntries: totalKbEntries >= MIN_STORE_KB_ENTRIES,
        hasShippingPolicy: !!store.shippingInfo,
        // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۳.۳ — گسترش چک‌لیست
        // (قبلاً فقط hasShippingPolicy)؛ همه‌ی این فیلدها از قبل روی Store هستند، بدون کوئری اضافه
        hasReturnPolicy: !!store.returnPolicy,
        hasBrandIntro: !!store.brandIntro,
        hasOwnerNotes: !!store.ownerNotes,
        hasWorkingHours: !!(store.workingHoursStart && store.workingHoursEnd),
      },
    };
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۳.۳/۳.۴ — موضوعات
  // تکرارشونده‌ای که ربات گیر کرده (AGENT_STUCK/SUPPORT_NEEDED) یا مشتری صریح خواسته انسان
  // (CUSTOMER_REQUESTED، همراه دلیل آزاد)، خوشه‌بندی‌شده با یک فراخوان LLM؛ برای تب «توجه».
  // نتیجه روی خود Store کش می‌شود (ATTENTION_SUGGESTIONS_TTL_MS) چون تولیدش یک فراخوان LLM
  // است و نباید با هر بار باز شدن تب دوباره محاسبه شود
  async getAttentionSuggestions(sellerId: string, storeId: string) {
    const store = await this.getOwned(sellerId, storeId);
    const isFresh =
      !!store.attentionSuggestionsComputedAt &&
      Date.now() - store.attentionSuggestionsComputedAt.getTime() <
        ATTENTION_SUGGESTIONS_TTL_MS;
    if (isFresh) {
      return {
        topics:
          (store.attentionSuggestions as unknown as AttentionSuggestionTopic[]) ??
          [],
        computedAt: store.attentionSuggestionsComputedAt,
      };
    }

    const topics = await this.computeAttentionSuggestionTopics(storeId);
    const computedAt = new Date();
    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        attentionSuggestions: topics as unknown as Prisma.InputJsonValue,
        attentionSuggestionsComputedAt: computedAt,
      },
    });
    return { topics, computedAt };
  }

  private async computeAttentionSuggestionTopics(
    storeId: string,
  ): Promise<AttentionSuggestionTopic[]> {
    const since = new Date(Date.now() - ATTENTION_SUGGESTIONS_LOOKBACK_MS);
    const handoffEvents = await this.prisma.conversationEvent.findMany({
      where: {
        type: 'TOOL_CALL',
        createdAt: { gte: since },
        conversation: { storeId },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: { conversationId: true, payload: true, createdAt: true },
    });
    const stuckEvents = handoffEvents.filter((e) => {
      const toolName = (e.payload as { toolName?: string })?.toolName;
      return (
        toolName === 'AGENT_STUCK' ||
        toolName === 'SUPPORT_NEEDED' ||
        toolName === 'CUSTOMER_REQUESTED'
      );
    });
    if (stuckEvents.length < MIN_STUCK_EVENTS_FOR_SUMMARY) return [];

    const conversationIds = [
      ...new Set(stuckEvents.map((e) => e.conversationId)),
    ];
    const customerMessages = await this.prisma.conversationEvent.findMany({
      where: {
        conversationId: { in: conversationIds },
        type: 'CUSTOMER_MESSAGE',
      },
      orderBy: { createdAt: 'asc' },
      select: { conversationId: true, payload: true, createdAt: true },
    });
    const messagesByConversation = new Map<string, string[]>();
    for (const m of customerMessages) {
      const text = (m.payload as { text?: string })?.text;
      if (!text) continue;
      const list = messagesByConversation.get(m.conversationId) ?? [];
      list.push(text);
      messagesByConversation.set(m.conversationId, list);
    }

    const cases = stuckEvents.map((e, i) => {
      const toolName = (e.payload as { toolName?: string }).toolName;
      const note = (e.payload as { note?: string }).note;
      const recentMessages = (
        messagesByConversation.get(e.conversationId) ?? []
      ).slice(-3);
      return `مورد ${i + 1} — دلیل: ${toolName}${note ? ` — یادداشت: ${note}` : ''}${
        recentMessages.length
          ? ` — آخرین پیام‌های مشتری: ${recentMessages.join(' / ')}`
          : ''
      }`;
    });

    const { object } = await generateObject({
      model: this.aiProvider.buildClient(undefined, {
        supportsStructuredOutputs: true,
      })(defaultModel()),
      schema: z.object({
        topics: z
          .array(
            z.object({
              topic: z
                .string()
                .describe('خلاصه‌ی کوتاه فارسی موضوع تکرارشونده'),
              field: z.enum([
                'brandIntro',
                'returnPolicy',
                'shippingInfo',
                'ownerNotes',
                'workingHours',
                'other',
              ]),
              summary: z
                .string()
                .describe(
                  'یک جمله توضیح برای فروشنده که چرا این را به پروفایلش اضافه کند',
                ),
              occurrences: z.number(),
            }),
          )
          .max(5),
      }),
      system: `فهرست زیر مواردی است که ربات فروش یک فروشگاه نتوانسته جواب مشتری را بدهد یا مشتری
صریح خواسته با انسان صحبت کند. موضوعات تکرارشونده را پیدا کن و خوشه‌بندی کن — هر خوشه یکی از
فیلدهای پروفایل فروشگاه (brandIntro=معرفی برند، returnPolicy=قوانین مرجوعی، shippingInfo=شرایط
ارسال، ownerNotes=یادداشت‌های آزاد فروشنده، workingHours=ساعت پاسخ‌گویی، other=هیچ‌کدام) را نشانه
می‌گیرد که اگر فروشنده پر کند، دفعه‌ی بعد ربات خودش جواب می‌دهد. فقط موضوعات واقعاً تکرارشونده
(حداقل ۲ مورد مشابه) را برگردان، نه موارد تکی. حداکثر ۵ خوشه، فقط JSON مطابق schema.`,
      prompt: cases.join('\n'),
    });
    return object.topics;
  }

  // عمداً public — StoreAdPlacementService (جایگاه تبلیغاتی محصول‌محور) هم از همین چک
  // مالکیت استفاده می‌کند (docs/PRD-product-display-focus-and-variations.md §۳)
  async getOwnedProduct(sellerId: string, storeId: string, productId: string) {
    await this.getOwned(sellerId, storeId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.storeId !== storeId)
      throw new NotFoundException(fa.store.productNotFound);
    return product;
  }

  async updateProduct(
    sellerId: string,
    storeId: string,
    productId: string,
    dto: UpdateProductDto,
  ) {
    const before = await this.getOwnedProduct(sellerId, storeId, productId);
    if (dto.code)
      await this.assertProductCodeAvailable(storeId, dto.code, productId);
    this.assertGoldPricingFieldsValid(
      dto.pricingModel ?? before.pricingModel,
      dto.weightGrams ?? before.weightGrams ?? undefined,
      dto.purityKarat ?? before.purityKarat ?? undefined,
      // فیدبک کاربر ۱۴۰۵/۰۷/۱۴ — برخلاف weight/purity بالا، اینجا باید null صریح (برگشت به
      // پیش‌فرض فروشگاه) را از undefined (فیلد اصلاً نفرستاده) تشخیص بدهیم؛ ?? با null هم
      // fallback می‌کند که اینجا اشتباه است
      dto.goldWageType !== undefined ? dto.goldWageType : before.goldWageType,
      dto.goldWageValue !== undefined
        ? dto.goldWageValue
        : before.goldWageValue,
      dto.goldProfitPercent !== undefined
        ? dto.goldProfitPercent
        : before.goldProfitPercent,
    );
    const { specs: rawSpecs, source, ...rest } = dto;
    const specs =
      rawSpecs !== undefined
        ? (clampProductSpecs(rawSpecs ?? undefined) ?? Prisma.DbNull)
        : undefined;
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { ...rest, ...(specs !== undefined ? { specs } : {}) },
    });
    // docs/PRD-seller-guide-assistant-modal.md بخش ۱.۳
    const textFieldChanges = (['name', 'description', 'ownerNotes'] as const)
      .filter((f) => rest[f] !== undefined && rest[f] !== before[f])
      .map((f) => ({
        storeId,
        sellerId,
        entityType: 'PRODUCT' as const,
        entityId: productId,
        fieldName: f,
        oldValue: before[f] ?? null,
        newValue: (rest[f] as string) ?? null,
        source,
      }));
    const specsChanged =
      specs !== undefined &&
      JSON.stringify(before.specs ?? null) !==
        JSON.stringify(updated.specs ?? null);
    await this.changeLog.logMany([
      ...textFieldChanges,
      ...(specsChanged
        ? [
            {
              storeId,
              sellerId,
              entityType: 'PRODUCT' as const,
              entityId: productId,
              fieldName: 'specs',
              oldValue: before.specs ? JSON.stringify(before.specs) : null,
              newValue: updated.specs ? JSON.stringify(updated.specs) : null,
              source,
            },
          ]
        : []),
    ]);
    return updated;
  }

  // docs/PRD-product-display-focus-and-variations.md §۴.۱ — همیشه جایگزین کامل (نه patch
  // تدریجی)، چون جدول ترکیب‌ها در پنل یک‌جا ذخیره می‌شود؛ هیچ محصولی هنگام ساخت اولیه این
  // را نمی‌سازد، فقط وقتی فروشنده صریح سوئیچ «چند حالت داره؟» را روشن کند
  async replaceProductVariants(
    sellerId: string,
    storeId: string,
    productId: string,
    dto: ReplaceProductVariantsDto,
  ) {
    await this.getOwnedProduct(sellerId, storeId, productId);

    const optionTypeNames = dto.optionTypes.map((o) => o.name);
    if (new Set(optionTypeNames).size !== optionTypeNames.length) {
      throw new BadRequestException(fa.store.variantOptionNamesDuplicate);
    }
    const valuesByName = new Map(
      dto.optionTypes.map((o) => [o.name, new Set(o.values)]),
    );
    const combosSeen = new Set<string>();
    for (const variant of dto.variants) {
      const keys = Object.keys(variant.optionValues);
      const valid =
        keys.length === optionTypeNames.length &&
        keys.every(
          (k) =>
            valuesByName.has(k) &&
            valuesByName.get(k)!.has(variant.optionValues[k]),
        );
      if (!valid) {
        throw new BadRequestException(fa.store.variantCombinationInvalid);
      }
      const comboKey = JSON.stringify(
        [...keys].sort().map((k) => [k, variant.optionValues[k]]),
      );
      if (combosSeen.has(comboKey)) {
        throw new BadRequestException(fa.store.variantCombinationDuplicate);
      }
      combosSeen.add(comboKey);
    }

    await this.prisma.$transaction([
      this.prisma.productVariant.deleteMany({ where: { productId } }),
      this.prisma.productOptionType.deleteMany({ where: { productId } }),
      ...dto.optionTypes.map((o, i) =>
        this.prisma.productOptionType.create({
          data: {
            productId,
            name: o.name,
            position: i,
            values: {
              create: o.values.map((v, j) => ({ value: v, position: j })),
            },
          },
        }),
      ),
      ...dto.variants.map((v) =>
        this.prisma.productVariant.create({
          data: {
            productId,
            optionValues: v.optionValues,
            stock: v.stock,
            priceOverride: v.priceOverride ?? null,
            sku: v.sku ?? null,
            weightGrams: v.weightGrams ?? null,
            purityKarat: v.purityKarat ?? null,
          },
        }),
      ),
    ]);

    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        optionTypes: {
          orderBy: { position: 'asc' },
          include: { values: { orderBy: { position: 'asc' } } },
        },
        variants: true,
      },
    });
  }

  async deleteProduct(sellerId: string, storeId: string, productId: string) {
    await this.getOwnedProduct(sellerId, storeId, productId);
    await this.prisma.product.delete({ where: { id: productId } });
    return { success: true };
  }

  // docs/PRD-product-display-focus-and-variations.md §۲.۴ — lazy-generate، نه در لحظه‌ی
  // ساخت محصول، تا محصولات قدیمی‌تر هم بدون migration داده پوشش داده شوند. همان الگوی
  // retry-on-collision auth.service.ts's generateUniqueReferralCode
  async getProductTelegramLink(
    sellerId: string,
    storeId: string,
    productId: string,
  ): Promise<{ shortCode: string }> {
    const product = await this.getOwnedProduct(sellerId, storeId, productId);
    if (product.telegramShortCode)
      return { shortCode: product.telegramShortCode };

    for (let attempt = 0; ; attempt++) {
      const code = generateShortCode();
      const clash = await this.prisma.product.findUnique({
        where: { telegramShortCode: code },
      });
      if (!clash) {
        await this.prisma.product.update({
          where: { id: productId },
          data: { telegramShortCode: code },
        });
        return { shortCode: code };
      }
      if (attempt > 5)
        throw new Error('failed to generate unique telegram short code');
    }
  }

  private static readonly MAX_PRODUCT_IMAGES = 4;

  // آپلود عکس محصول (فیدبک اول پایلوت) — الگوی اعتبارسنجی دقیقاً مثل submitReceipt در
  // sales-agent.service.ts (mimetype چک می‌شود، نه پسوند فایل)
  async addProductImages(
    sellerId: string,
    storeId: string,
    productId: string,
    files: Express.Multer.File[],
  ) {
    const product = await this.getOwnedProduct(sellerId, storeId, productId);
    if (
      product.images.length + files.length >
      StoreService.MAX_PRODUCT_IMAGES
    ) {
      throw new BadRequestException(fa.store.tooManyImages);
    }
    const keys: string[] = [];
    for (const file of files) {
      if (!file.mimetype.startsWith('image/')) {
        throw new BadRequestException(fa.store.imageOnly);
      }
      const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
      keys.push(await this.storage.uploadImage(file.buffer, ext));
    }
    return this.prisma.product.update({
      where: { id: productId },
      data: { images: { push: keys } },
    });
  }

  // docs/PRD-seller-knowledge-base.md بخش ۲.۵ — تصاویر پیشنهادی صفحه‌ی مبدأ، فقط بعد از
  // تأیید صریح فروشنده دانلود و به استوریج خودمان آپلود می‌شوند (نه مستقیم لینک خارجی ذخیره
  // شود، که با حذف/تغییر آن صفحه لینک‌های ما هم می‌شکند). یک URL ناموفق کل درخواست را
  // نمی‌ترکاند — فقط همان یکی رد می‌شود
  async addProductImagesFromUrl(
    sellerId: string,
    storeId: string,
    productId: string,
    urls: string[],
  ) {
    const product = await this.getOwnedProduct(sellerId, storeId, productId);
    const room = StoreService.MAX_PRODUCT_IMAGES - product.images.length;
    if (room <= 0) throw new BadRequestException(fa.store.tooManyImages);

    const keys: string[] = [];
    for (const url of urls.slice(0, room)) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
        });
        const contentType = res.headers.get('content-type') ?? '';
        if (!res.ok || !contentType.startsWith('image/')) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > 5 * 1024 * 1024) continue;
        const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
        keys.push(await this.storage.uploadImage(buffer, ext));
      } catch {
        // یک URL ناموفق کل درخواست را نمی‌ترکاند — فقط همان یکی رد می‌شود
      }
    }
    if (keys.length === 0) return product;
    return this.prisma.product.update({
      where: { id: productId },
      data: { images: { push: keys } },
    });
  }

  async removeProductImage(
    sellerId: string,
    storeId: string,
    productId: string,
    key: string,
  ) {
    const product = await this.getOwnedProduct(sellerId, storeId, productId);
    const remaining = product.images.filter((k) => k !== key);
    await this.storage.deleteObject(key).catch(() => undefined);
    return this.prisma.product.update({
      where: { id: productId },
      data: { images: remaining },
    });
  }

  // بدون چک مالکیت (سلر) — محتوای عمومی ویترین است، باید در <img> مرورگر مشتری ناشناس
  // هم لود شود؛ بدون storeId (productId+key به‌تنهایی کافی است) — فقط چک می‌کند کلید واقعاً
  // داخل images همین محصول است تا کلید دلخواه سرو نشود
  async getProductImage(productId: string, key: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || !product.images.includes(key)) {
      throw new NotFoundException(fa.store.productNotFound);
    }
    const ext = key.split('.').pop() ?? '';
    const buffer = await this.storage.downloadImage(key);
    return { buffer, mimeType: mimeTypeForExt(ext) };
  }

  // docs/PRD-product-video.md بخش ۴ — چندویدیویی (سقف ۴ تا، مثل images)؛ عیناً همون سقف
  // فرمت/magic-bytes که video-edit.service.ts/caption-studio.service.ts استفاده می‌کنند
  // (فقط mp4/mov ورودی قبول می‌شود، همیشه به mp4 نرمال‌سازی می‌شود)
  private static readonly MAX_PRODUCT_VIDEOS = 4;
  private static readonly MAX_PRODUCT_VIDEO_BYTES = 50 * 1024 * 1024;
  private static readonly MAX_PRODUCT_VIDEO_DURATION_SEC = 90;
  private static readonly PRODUCT_VIDEO_MIME_EXT: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
  };

  // امضای مشترک ISO-BMFF (mp4/mov) — همون الگوی video-edit.service.ts، تشخیص با magic
  // bytes نه فقط mimetype ادعایی کلاینت
  private matchesVideoMagicBytes(buffer: Buffer): boolean {
    return (
      buffer.length > 8 && buffer.subarray(4, 8).toString('ascii') === 'ftyp'
    );
  }

  async uploadProductVideo(
    sellerId: string,
    storeId: string,
    productId: string,
    file: Express.Multer.File,
  ) {
    const product = await this.getOwnedProduct(sellerId, storeId, productId);
    const existingVideos = parseProductVideos(product.videos);
    if (existingVideos.length >= StoreService.MAX_PRODUCT_VIDEOS) {
      throw new BadRequestException(fa.store.tooManyVideos);
    }
    if (file.size > StoreService.MAX_PRODUCT_VIDEO_BYTES) {
      throw new BadRequestException(fa.store.videoTooLarge);
    }
    const ext = StoreService.PRODUCT_VIDEO_MIME_EXT[file.mimetype];
    if (!ext || !this.matchesVideoMagicBytes(file.buffer)) {
      throw new BadRequestException(fa.store.videoOnly);
    }

    let storeBuffer = file.buffer;
    let storeExt = ext;
    try {
      const normalized = await this.mediaTranscode.normalizeVideoForProviders(
        file.buffer,
        ext,
      );
      storeBuffer = normalized.buffer;
      storeExt = normalized.ext;
    } catch {
      throw new BadRequestException(fa.store.videoTranscodeFailed);
    }

    const durationSec = await this.mediaTranscode.getVideoDuration(
      storeBuffer,
      storeExt,
    );
    if (durationSec > StoreService.MAX_PRODUCT_VIDEO_DURATION_SEC) {
      throw new BadRequestException(fa.store.videoTooLong);
    }

    const key = await this.storage.uploadImage(storeBuffer, storeExt);
    const videos: ProductVideoItem[] = [
      ...existingVideos,
      { key, durationSec: Math.round(durationSec) },
    ];
    return this.prisma.product.update({
      where: { id: productId },
      data: { videos },
    });
  }

  async removeProductVideo(
    sellerId: string,
    storeId: string,
    productId: string,
    key: string,
  ) {
    const product = await this.getOwnedProduct(sellerId, storeId, productId);
    const videos = parseProductVideos(product.videos).filter(
      (v) => v.key !== key,
    );
    await this.storage.deleteObject(key).catch(() => undefined);
    return this.prisma.product.update({
      where: { id: productId },
      data: { videos },
    });
  }

  // بدون چک مالکیت (سلر) — محتوای عمومی ویترین، باید برای مرورگر خریدار ناشناس هم قابل‌پخش
  // باشد؛ فقط چک می‌کند کلید واقعاً داخل videos همین محصول است تا کلید دلخواه سرو نشود.
  // برخلاف getProductImage (کل بافر)، اینجا فقط وجود/مالکیت را تایید می‌کند — پخش واقعی با
  // Range request توسط خودِ کنترلر (sales-agent.controller.ts) با storage.getObjectStream انجام می‌شود
  async assertProductVideoKey(productId: string, key: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (
      !product ||
      !parseProductVideos(product.videos).some((v) => v.key === key)
    ) {
      throw new NotFoundException(fa.store.videoNotFound);
    }
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۴ — عکس پروفایل فروشگاه؛ همون الگوی
  // addProductImages بالا، تک‌فیلد نه آرایه (عکس قبلی، اگر بود، جایگزین می‌شود)
  async uploadStoreLogo(
    sellerId: string,
    storeId: string,
    file: Express.Multer.File,
  ) {
    const store = await this.getOwned(sellerId, storeId);
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException(fa.store.imageOnly);
    }
    const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const key = await this.storage.uploadImage(file.buffer, ext);
    if (store.logoImageKey) {
      await this.storage
        .deleteObject(store.logoImageKey)
        .catch(() => undefined);
    }
    return this.prisma.store.update({
      where: { id: storeId },
      data: { logoImageKey: key },
    });
  }

  async removeStoreLogo(sellerId: string, storeId: string) {
    const store = await this.getOwned(sellerId, storeId);
    if (store.logoImageKey) {
      await this.storage
        .deleteObject(store.logoImageKey)
        .catch(() => undefined);
    }
    return this.prisma.store.update({
      where: { id: storeId },
      data: { logoImageKey: null },
    });
  }

  // بدون چک مالکیت — محتوای عمومی ویترین، باید در <img> مرورگر مشتری ناشناس و در پیام
  // /start تلگرام (فچ از سمت سرورهای تلگرام) هم لود شود؛ فقط چک می‌کند کلید واقعاً همون
  // logoImageKey همین فروشگاه است تا کلید دلخواه سرو نشود
  async getStoreLogo(storeId: string, key: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store || store.logoImageKey !== key) {
      throw new NotFoundException(fa.store.logoNotFound);
    }
    const ext = key.split('.').pop() ?? '';
    const buffer = await this.storage.downloadImage(key);
    return { buffer, mimeType: mimeTypeForExt(ext) };
  }

  // parse-and-commit (نه دو-مرحله‌ای پیش‌نمایش) — فقط محصول جدید می‌سازد، upsert نیست چون
  // کلید طبیعی (SKU) نداریم؛ الگوی برگرفته از admin.service.ts importModels
  async importProducts(sellerId: string, storeId: string, buffer: Buffer) {
    await this.getOwned(sellerId, storeId);

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException(fa.store.excelUnreadable);
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    if (rows.length === 0) throw new BadRequestException(fa.store.excelEmpty);

    const headerMap = new Map<
      string,
      'name' | 'basePrice' | 'stock' | 'description'
    >();
    for (const key of Object.keys(rows[0])) {
      const normalized =
        PRODUCT_IMPORT_COLUMNS[key.trim()] ??
        PRODUCT_IMPORT_COLUMNS[key.trim().toLowerCase()];
      if (normalized) headerMap.set(key, normalized);
    }
    const mappedTargets = new Set(headerMap.values());
    if (!mappedTargets.has('name') || !mappedTargets.has('basePrice')) {
      throw new BadRequestException(fa.store.excelUnknownColumns);
    }

    let created = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // ردیف ۱ هدر است
      const raw = rows[i];
      const data: Record<string, unknown> = {};
      for (const [key, target] of headerMap) {
        data[target] =
          target === 'name' || target === 'description'
            ? cellToString(raw[key])
            : cellToNumber(raw[key]);
      }

      const instance = plainToInstance(CreateProductDto, data);
      const violations = await validate(instance);
      if (violations.length > 0) {
        const message = violations
          .map((v) => Object.values(v.constraints ?? {}).join('، '))
          .join(' | ');
        errors.push({ row: rowNumber, message });
        continue;
      }

      try {
        // ستون‌های اکسل هیچ‌وقت specs نمی‌سازند (headerMap فقط name/basePrice/stock/description
        // را می‌شناسد)؛ specs:undefined فقط برای رضایت تایپ Prisma.Json است (مثل نبودِ کلید)
        await this.prisma.product.create({
          data: { ...instance, specs: undefined, storeId },
        });
        created++;
      } catch {
        errors.push({ row: rowNumber, message: 'خطا در ذخیره‌سازی این ردیف' });
      }
    }

    return { created, errors };
  }

  // docs/PRD-mvp-launch-plan.md گام ۱ — حداقلی، بدون UI: فروشنده باید بتواند سفارش‌های
  // در انتظار تایید را ببیند/تایید/رد کند تا حلقه‌ی سفارش با curl قابل تست باشد؛ صف کامل
  // با نمایش تصویر رسید در پنل موبایل، گام ۳ است.
  async listOrders(sellerId: string, storeId: string, status?: OrderStatus) {
    await this.getOwned(sellerId, storeId);
    const orders = await this.prisma.order.findMany({
      where: { storeId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۳.۲ — عکس محصول در
    // جزئیات سفارش؛ items فقط productId/name/unitPrice/qty را snapshot کرده (نه عکس)، پس
    // اینجا join سبک با Product انجام می‌شود (فقط همین صفحه، نه تغییر در ساختار items ذخیره‌شده)
    const productIds = [
      ...new Set(
        orders.flatMap((o) =>
          (o.items as { productId: string }[]).map((i) => i.productId),
        ),
      ),
    ];
    const products = productIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, images: true },
        })
      : [];
    const imageByProductId = new Map(
      products.map((p) => [p.id, p.images[0] ?? null]),
    );
    return orders.map((order) => ({
      ...order,
      items: (
        order.items as {
          productId: string;
          name: string;
          unitPrice: number;
          qty: number;
        }[]
      ).map((item) => ({
        ...item,
        imageKey: imageByProductId.get(item.productId) ?? null,
      })),
    }));
  }

  async getOwnedOrder(sellerId: string, storeId: string, orderId: string) {
    await this.getOwned(sellerId, storeId);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order || order.storeId !== storeId)
      throw new NotFoundException(fa.salesAgent.orderNotFound);
    return order;
  }

  async approveOrder(sellerId: string, storeId: string, orderId: string) {
    const order = await this.getOwnedOrder(sellerId, storeId, orderId);
    // فیدبک کاربر — فروشنده باید بتواند بعد از رد اشتباهی یک سفارش، دوباره تاییدش کند
    // (REJECTED -> APPROVED مجاز است)؛ اما اگر از قبل APPROVED بوده، بی‌صدا نادیده می‌گیریم
    // تا totalConfirmedToman دوباره increment نشود و requestReviewFollowUp دوبار پیام نفرستد
    if (order.status === 'APPROVED') return order;
    // docs/PRD-conversation-history.md — تأیید سفارش یعنی مکالمه واقعاً تمام شده: هم
    // currentState (COMPLETED، تا امروز هیچ‌جا ست نمی‌شد) هم archivedAt پر می‌شود تا هم
    // TERMINAL_STATES فرانت درست کار کند هم مکالمه از «فعال» بودن خارج شود
    const approved = await this.prisma.$transaction(async (tx) => {
      // docs/PRD-seller-multi-bank-card-rotation.md بخش ۲ — فقط روی تایید واقعی (نه لحظه‌ی
      // نمایش) به سقف THRESHOLD همان کارت اضافه می‌شود؛ خریدار ممکن است اصلاً پرداخت نکند
      if (order.bankCardId) {
        await tx.storeBankCard.update({
          where: { id: order.bankCardId },
          data: { totalConfirmedToman: { increment: order.totalAmount } },
        });
      }
      await tx.salesConversation.update({
        where: { id: order.conversationId },
        data: { currentState: 'COMPLETED', archivedAt: new Date() },
      });
      return tx.order.update({
        where: { id: orderId },
        data: { status: 'APPROVED', approvedAt: new Date() },
      });
    });
    await this.requestReviewFollowUp(order);
    return approved;
  }

  // docs/PRD-customer-comments-and-discounts.md بخش الف/۳ — بعد از تایید سفارش، یک پیام
  // پیگیری ثابت (نه LLM-generated) باز می‌شود؛ اولین پیام آزاد بعدی مشتری در همین مکالمه
  // (که به conversation-engine.service.ts's handleMessage می‌رسد، حتی بعد از COMPLETED —
  // برخلاف «گفتگوی جدید»، مشتری همان conversationId را در مرورگرش باز نگه می‌دارد) طبق
  // flag تازه‌ی contextData.awaitingReview یک ProductComment می‌شود، نه یک پیام معمولی
  private async requestReviewFollowUp(order: {
    conversationId: string;
    items: Prisma.JsonValue;
  }): Promise<void> {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: order.conversationId },
      include: { customer: true },
    });
    if (!conversation) return;

    const items = order.items as { productId: string }[];
    const distinctProductIds = [...new Set(items.map((i) => i.productId))];
    const awaitingReviewProductId =
      distinctProductIds.length === 1 ? distinctProductIds[0] : null;

    const text = fa.salesAgent.reviewFollowUpPrompt;
    const existingContext = (conversation.contextData ??
      {}) as Prisma.JsonObject;
    await this.prisma.$transaction([
      this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'AGENT_REPLY',
          payload: { text },
        },
      }),
      this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: {
          contextData: {
            ...existingContext,
            awaitingReview: true,
            awaitingReviewProductId,
          },
        },
      }),
    ]);

    if (
      conversation.customer.channel === 'TELEGRAM' &&
      conversation.customer.telegramChatId
    ) {
      await this.telegramApi.sendText(
        conversation.customer.telegramChatId,
        text,
      );
    }
  }

  async rejectOrder(
    sellerId: string,
    storeId: string,
    orderId: string,
    reason?: string,
  ) {
    const order = await this.getOwnedOrder(sellerId, storeId, orderId);
    // فیدبک کاربر — جلوگیری از تکرار پیام رد به خریدار اگر همین سفارش از قبل رد شده بود
    // (مثلاً دوبار زدن دکمه‌ی رد قدیمی روی تلگرام)
    if (order.status === 'REJECTED') return order;
    const [, updated] = await this.prisma.$transaction([
      this.prisma.salesConversation.update({
        where: { id: order.conversationId },
        // isMutedForHuman: true — بدون این، پیام بعدی خریدار (که فرانت دیگر برایش input را
        // قفل نمی‌کند، طبق همان بنر/پیامی که می‌گوید «می‌تونی همینجا صحبت کنی») مستقیم به
        // موتور مکالمه‌ی رباتی می‌رفت که اصلاً برای state=REJECTED طراحی نشده؛ همان مکانیزمی
        // که برای HANDOFF_HUMAN استفاده می‌شود (sales-agent.service.ts سطر ۲۳۲) پیام را لاگ
        // می‌کند تا فروشنده در تب «نیاز به توجه» ببیندش
        data: {
          currentState: 'REJECTED',
          archivedAt: new Date(),
          isMutedForHuman: true,
        },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'REJECTED',
          rejectReason: reason,
          rejectedAt: new Date(),
        },
      }),
    ]);
    await this.notifyBuyerOfRejection(order, reason);
    return updated;
  }

  // فیدبک کاربر — خریدار بعد از رد سفارش توسط فروشنده هیچ اطلاعی توی چت نمی‌گرفت؛ عیناً
  // الگوی requestReviewFollowUp بالا (ConversationEvent + پوش تلگرام اگر کانال خریدار تلگرام است)
  private async notifyBuyerOfRejection(
    order: { conversationId: string },
    reason?: string,
  ): Promise<void> {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: order.conversationId },
      include: { customer: true },
    });
    if (!conversation) return;

    const text = fa.salesAgent.orderRejectedMessage(reason);
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'AGENT_REPLY',
        payload: { text },
      },
    });

    if (
      conversation.customer.channel === 'TELEGRAM' &&
      conversation.customer.telegramChatId
    ) {
      await this.telegramApi.sendText(
        conversation.customer.telegramChatId,
        text,
      );
    }
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۳.۲ — عیناً هم‌الگوی
  // approveOrder/rejectOrder بالا؛ نیازی به دست‌زدن به salesConversation نیست چون با تایید
  // سفارش از قبل COMPLETED/archived شده است
  async shipOrder(sellerId: string, storeId: string, orderId: string) {
    const order = await this.getOwnedOrder(sellerId, storeId, orderId);
    // فیدبک کاربر — کلیک دوباره‌ی دکمه‌ی «ارسال شد» نباید notifyBuyerOfShipment را دوباره بفرستد
    if (order.status === 'SHIPPED') return order;
    const shipped = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'SHIPPED', shippedAt: new Date() },
    });
    await this.notifyBuyerOfShipment(order);
    return shipped;
  }

  // عیناً الگوی notifyBuyerOfRejection بالا — خریدار باید بفهمد سفارشش ارسال شده
  private async notifyBuyerOfShipment(order: {
    conversationId: string;
  }): Promise<void> {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: order.conversationId },
      include: { customer: true },
    });
    if (!conversation) return;

    const text = fa.salesAgent.orderShippedMessage;
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'AGENT_REPLY',
        payload: { text },
      },
    });

    if (
      conversation.customer.channel === 'TELEGRAM' &&
      conversation.customer.telegramChatId
    ) {
      await this.telegramApi.sendText(
        conversation.customer.telegramChatId,
        text,
      );
    }
  }

  // الگوی conversations.service.ts getImage — کلید در storage هیچ‌وقت مستقیم به فرانت داده
  // نمی‌شود، همیشه از پشت JwtGuard+مالکیت سرو می‌شود
  async getReceiptImage(sellerId: string, storeId: string, orderId: string) {
    const order = await this.getOwnedOrder(sellerId, storeId, orderId);
    if (!order.receiptImageKey)
      throw new NotFoundException(fa.store.noReceiptImage);
    const ext = order.receiptImageKey.split('.').pop() ?? '';
    const buffer = await this.storage.downloadImage(order.receiptImageKey);
    return { buffer, mimeType: mimeTypeForExt(ext) };
  }

  // docs/PRD-seller-growth-tools-and-marketplace-trust.md بخش ۱.۱ — تجمیع مستقیم روی Order،
  // بدون مدل/جدول rollup جدا (حجم فعلی سفارش‌ها کم است)؛ ایندکس [storeId, createdAt] تازه
  // روی Order همین کوئری را پوشش می‌دهد
  async getDashboard(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 6);
    const monthStart = new Date(todayStart);
    monthStart.setDate(monthStart.getDate() - 29);

    const [approvedOrders, orderCountsByStatus] = await Promise.all([
      this.prisma.order.findMany({
        where: { storeId, status: 'APPROVED' },
        select: {
          totalAmount: true,
          createdAt: true,
          items: true,
          conversation: { select: { customerId: true } },
        },
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: { storeId },
        _count: { _all: true },
      }),
    ]);

    const sumSince = (since: Date) =>
      approvedOrders
        .filter((o) => o.createdAt >= since)
        .reduce((sum, o) => sum + o.totalAmount, 0);

    const dailyRevenueTrend: { date: string; totalToman: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(todayStart);
      day.setDate(day.getDate() - i);
      const nextDay = new Date(day);
      nextDay.setDate(nextDay.getDate() + 1);
      const totalToman = approvedOrders
        .filter((o) => o.createdAt >= day && o.createdAt < nextDay)
        .reduce((sum, o) => sum + o.totalAmount, 0);
      dailyRevenueTrend.push({
        date: day.toISOString().slice(0, 10),
        totalToman,
      });
    }

    const productTotals = new Map<string, { name: string; qty: number }>();
    for (const order of approvedOrders) {
      const items = order.items as {
        productId: string;
        name: string;
        qty: number;
      }[];
      for (const item of items) {
        const existing = productTotals.get(item.productId);
        if (existing) existing.qty += item.qty;
        else
          productTotals.set(item.productId, { name: item.name, qty: item.qty });
      }
    }
    const topProducts = [...productTotals.entries()]
      .map(([productId, v]) => ({ productId, name: v.name, qty: v.qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    const uniqueCustomerCount = new Set(
      approvedOrders.map((o) => o.conversation.customerId),
    ).size;
    const totalRevenueAllTimeToman = approvedOrders.reduce(
      (sum, o) => sum + o.totalAmount,
      0,
    );
    const averageOrderValueToman =
      approvedOrders.length === 0
        ? 0
        : Math.round(totalRevenueAllTimeToman / approvedOrders.length);

    const countByStatus: Record<OrderStatus, number> = {
      PENDING_PAYMENT: 0,
      RECEIPT_SUBMITTED: 0,
      APPROVED: 0,
      REJECTED: 0,
      SHIPPED: 0,
    };
    for (const row of orderCountsByStatus) {
      countByStatus[row.status] = row._count._all;
    }

    return {
      revenueTodayToman: sumSince(todayStart),
      revenueWeekToman: sumSince(weekStart),
      revenueMonthToman: sumSince(monthStart),
      orderCountsByStatus: countByStatus,
      dailyRevenueTrend,
      topProducts,
      uniqueCustomerCount,
      averageOrderValueToman,
    };
  }

  // docs/PRD-seller-growth-tools-and-marketplace-trust.md بخش ۱.۲ — CSV ساده با هدر فارسی،
  // به‌جای xlsx واقعی (سریع‌تر، بدون نیاز به کتابخانه‌ی اضافه برای نوشتن)
  async exportOrdersCsv(sellerId: string, storeId: string): Promise<string> {
    await this.getOwned(sellerId, storeId);
    const orders = await this.prisma.order.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
    const lines = [fa.store.csvOrdersHeader.map(csvEscape).join(',')];
    for (const order of orders) {
      const items = order.items as { name: string; qty: number }[];
      const productNames = items.map((i) => `${i.name} × ${i.qty}`).join(' + ');
      lines.push(
        [
          order.createdAt.toLocaleDateString('fa-IR'),
          productNames,
          order.totalAmount.toLocaleString('fa-IR'),
          fa.store.csvOrderStatusLabels[order.status] ?? order.status,
          order.shippingProvince ?? '',
          order.shippingAddress ?? '',
          order.recipientName ?? '',
          order.recipientPhone ?? '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    return lines.join('\n');
  }

  async exportProductsCsv(sellerId: string, storeId: string): Promise<string> {
    await this.getOwned(sellerId, storeId);
    const [products, approvedOrders] = await Promise.all([
      this.prisma.product.findMany({ where: { storeId } }),
      this.prisma.order.findMany({
        where: { storeId, status: 'APPROVED' },
        select: { items: true },
      }),
    ]);
    const soldQtyByProduct = new Map<string, number>();
    for (const order of approvedOrders) {
      const items = order.items as { productId: string; qty: number }[];
      for (const item of items) {
        soldQtyByProduct.set(
          item.productId,
          (soldQtyByProduct.get(item.productId) ?? 0) + item.qty,
        );
      }
    }
    const lines = [fa.store.csvProductsHeader.map(csvEscape).join(',')];
    for (const product of products) {
      lines.push(
        [
          product.name,
          product.basePrice.toLocaleString('fa-IR'),
          product.stock,
          soldQtyByProduct.get(product.id) ?? 0,
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    return lines.join('\n');
  }

  async exportCreditUsageCsv(
    sellerId: string,
    storeId: string,
  ): Promise<string> {
    await this.getOwned(sellerId, storeId);
    const events = await this.prisma.creditUsageEvent.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
    const lines = [fa.store.csvCreditUsageHeader.map(csvEscape).join(',')];
    for (const event of events) {
      lines.push(
        [
          event.createdAt.toLocaleDateString('fa-IR'),
          fa.store.csvCreditUsageKindLabels[event.kind] ?? event.kind,
          event.costToman.toLocaleString('fa-IR'),
          event.isFreeQuota
            ? fa.store.csvCreditUsageFreeYes
            : fa.store.csvCreditUsageFreeNo,
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    return lines.join('\n');
  }

  async listNeededAttention(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    const conversations = await this.prisma.salesConversation.findMany({
      where: { storeId, isMutedForHuman: true },
      orderBy: { updatedAt: 'desc' },
      include: { customer: true, order: true },
    });
    return conversations.map((c) => ({
      id: c.id,
      customerLabel: c.customer.phone ?? c.customer.fullName ?? 'مشتری ناشناس',
      currentState: c.currentState,
      updatedAt: c.updatedAt,
      // docs/PRD-seller-panel-order-chat-linking.md بخش ۲.۱ — سفارش مربوط به این مکالمه،
      // اگر وجود داشته باشد (رابطه‌ی ۱:۱ از قبل در schema هست)
      orderId: c.order?.id ?? null,
    }));
  }

  async getOwnedConversation(
    sellerId: string,
    storeId: string,
    conversationId: string,
  ) {
    await this.getOwned(sellerId, storeId);
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { customer: true, order: true },
    });
    if (!conversation || conversation.storeId !== storeId)
      throw new NotFoundException(fa.salesAgent.conversationNotFound);
    return conversation;
  }

  async getConversation(
    sellerId: string,
    storeId: string,
    conversationId: string,
  ) {
    const conversation = await this.getOwnedConversation(
      sellerId,
      storeId,
      conversationId,
    );
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    return {
      id: conversation.id,
      isMutedForHuman: conversation.isMutedForHuman,
      currentState: conversation.currentState,
      customerLabel:
        conversation.customer.phone ??
        conversation.customer.fullName ??
        'مشتری ناشناس',
      // docs/PRD-seller-panel-order-chat-linking.md بخش ۲.۱
      orderId: conversation.order?.id ?? null,
      events,
    };
  }

  async sendSellerMessage(
    sellerId: string,
    storeId: string,
    conversationId: string,
    text: string,
  ) {
    const conversation = await this.getOwnedConversation(
      sellerId,
      storeId,
      conversationId,
    );
    const event = await this.prisma.conversationEvent.create({
      data: { conversationId, type: 'SELLER_MESSAGE', payload: { text } },
    });
    // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — قبلاً فقط وب (polling) این پیام را می‌دید؛
    // اگر مشتری از کانال تلگرام است، مستقیم پوش می‌شود
    if (
      conversation.customer.channel === 'TELEGRAM' &&
      conversation.customer.telegramChatId
    ) {
      await this.telegramApi.sendText(
        conversation.customer.telegramChatId,
        text,
      );
    }
    return event;
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — لینک اتصال یک‌بارمصرف («بیشتر» ← «اتصال
  // تلگرام»)؛ توکن کوتاه رندوم روی خودِ Store ذخیره می‌شود (نه یک جدول جدا) و بعد از مصرف
  // پاک می‌شود — TelegramService.handleStart این را با پیلود seller_<token> تشخیص می‌دهد
  async createTelegramConnectToken(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    const token = randomBytes(6).toString('base64url');
    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        telegramConnectToken: token,
        telegramConnectTokenExpiresAt: new Date(
          Date.now() + TELEGRAM_CONNECT_TOKEN_TTL_MS,
        ),
      },
    });
    return { token };
  }

  // docs/PRD-seller-telegram-management-bot.md — وضعیت اتصال بات مدیریت پنل؛ اتصال خودش از
  // داخل بات انجام می‌شود (اشتراک شماره + OTP)، نه از پنل وب — اینجا فقط برای نمایش وضعیت/قطع
  async getSellerBotStatus(sellerId: string, storeId: string) {
    const store = await this.getOwned(sellerId, storeId);
    return {
      linked: !!store.sellerBotChatId,
      linkedAt: store.sellerBotLinkedAt,
    };
  }

  async disconnectSellerBot(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    await this.prisma.store.update({
      where: { id: storeId },
      data: { sellerBotChatId: null, sellerBotLinkedAt: null },
    });
    return { linked: false, linkedAt: null };
  }

  // «برگردون به ربات» — دستی، هیچ‌جا خودکار ریست نمی‌شود؛ currentState هم به BROWSING
  // برمی‌گردد چون دیسپچ موتور مکالمه (doUpdateCart و مشابه) فقط BROWSING/CART_REVIEW را
  // قبول می‌کند و سبد داخل contextData همچنان دست‌نخورده می‌ماند
  async unmuteConversation(
    sellerId: string,
    storeId: string,
    conversationId: string,
  ) {
    await this.getOwnedConversation(sellerId, storeId, conversationId);
    return this.prisma.salesConversation.update({
      where: { id: conversationId },
      data: {
        isMutedForHuman: false,
        currentState: 'BROWSING',
        clarifyAttempts: 0,
      },
    });
  }
}
