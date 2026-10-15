import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  OrderChannel,
  OrderStatus,
  OrderPaymentMethod,
  GoldWageType,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as XLSX from 'xlsx';
import { randomBytes } from 'crypto';
import { generateObject } from 'ai';
import { z } from 'zod';
import { AiProviderService } from '../../common/services/ai-provider.service';
import {
  defaultModel,
  withDefaultModelFallbackChain,
} from '../sales-agent/model-variants';
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
import { BUYER_VISIBLE, UNLIMITED_STOCK } from './product-visibility';
import { missingForPublish, type PublishCandidate } from './product-publish.util';
import { ProductEventService } from '../../common/analytics/product-event.service';
import { slugFromName, suggestSlug, type SlugSuggestion } from '../../common/utils/slug-from-name';
import {
  csvEscape,
  parseImportNumber,
  planVariantSync,
  variantComboKey,
} from './seller-catalog.util';
import { SUCCESSFUL_ORDER_STATUSES } from '../../common/constants/sales-ops.constants';
import { StockAlertService } from '../order-lifecycle/stock-alert.service';
import {
  addTehranDays,
  startOfTehranDay,
  tehranDateString,
} from '../../common/utils/tehran-time.util';
import { getRecentConversationEvents } from '../../common/utils/conversation-events.util';
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
import { safeFetch } from '../../common/utils/safe-fetch.util';
import { StoreCreditDeductionService } from '../store-credit-engine/store-credit-deduction.service';
import { OrderStateService } from '../order-lifecycle/order-state.service';
import {
  displayOrderCode,
  normalizeOrderCodeInput,
  normalizeOrderCodePartialInput,
} from '../../common/utils/order-code.util';
import { toEnglishDigits } from '../../common/utils/normalize-digits';
import {
  formatShippingDays,
  isValidShippingDays,
} from '../../common/utils/shipping-days.util';
import { ORDER_CARRIERS } from '../../common/constants/sales-ops.constants';
import {
  computeDisplayPrice,
  describeGoldPricing,
  GoldPriceUnavailableError,
  GoldPricingNotConfiguredError,
} from './product-pricing.util';

// docs/PRD-product-strategy-and-roadmap.md بخش ۳.۱ — چک‌لیست سطح فروشگاه
// SP-2 §4.11.5 — نسخه‌ی متن شرایط استفاده که با ساخت فروشگاه پذیرفته می‌شود (R3.7 متن را می‌سازد)
const TERMS_VERSION = '1404-07';
export type ListableProductStatus = 'ACTIVE' | 'DRAFT' | 'HIDDEN';
const MIN_STORE_KB_ENTRIES = 3;
// R2.1 — همان آستانه‌ی نشان «توجه» در نوار پنل (قبلاً در فرانت)
const LOW_STOCK_BADGE_THRESHOLD = 3;

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
  return parseImportNumber(value);
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly telegramApi: TelegramApiClientService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly changeLog: ContentChangeLogService,
    private readonly marketPrices: MarketPricesService,
    private readonly aiProvider: AiProviderService,
    private readonly comments: CommentsService,
    private readonly creditDeduction: StoreCreditDeductionService,
    private readonly orderState: OrderStateService,
    private readonly stockAlerts: StockAlertService,
    private readonly productEvents: ProductEventService,
  ) {}

  async list(sellerId: string) {
    const stores = await this.prisma.store.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: { products: true },
    });
    // SP-6 — «لینک بعد از اولین مشتری قفل می‌شود»: فرانت بدون حدس‌زدن بداند slug قابل ویرایش است یا نه
    const locks = await Promise.all(
      stores.map((st) =>
        this.prisma.salesConversation.count({ where: { storeId: st.id, isTest: false } }),
      ),
    );
    return stores.map((st, i) => ({ ...st, slugLocked: locks[i] > 0 }));
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
  // SP-2 §4.2 — base: slug درخواستی (اگر معتبر) وگرنه ترجمه‌ی نام؛ همان الگوریتم پیشنهاد
  async suggestSlug(
    name?: string,
    slug?: string,
    alsoTaken: ReadonlySet<string> = new Set(),
  ): Promise<SlugSuggestion> {
    const requested = slug && /^[a-z0-9-]{3,40}$/.test(slug) ? slug : '';
    const base = requested || slugFromName(name ?? '');
    return suggestSlug(
      base,
      async (s) => alsoTaken.has(s) || !(await this.isSlugAvailable(s)),
    );
  }

  async create(sellerId: string, dto: CreateStoreDto) {
    this.assertBankCardPair(dto);
    // R3.5 / D-1 — هر فروشنده یک فروشگاه واقعی؛ فروشگاه نمایشی (isDemo) جدا حساب می‌شود
    const existingReal = await this.prisma.store.count({
      where: { sellerId, isDemo: false },
    });
    if (existingReal > 0) {
      throw new ConflictException(fa.store.alreadyHasStore);
    }
    const config = await getSalesAgentGlobalConfig(this.prisma);
    const now = new Date();
    const trialEndsAt = new Date(
      now.getTime() + config.trialDurationDays * 24 * 60 * 60 * 1000,
    );
    // هیچ‌وقت ۴۰۹ برای تداخل slug نمی‌دهیم: اگر بین پیشنهاد و create کسی slug را گرفت (P2002)،
    // با گزینه‌ی بعدی تا ۵ بار تکرار می‌شود
    const triedSlugs = new Set<string>();
    let suggestion = await this.suggestSlug(dto.name, dto.slug);
    for (let attempt = 0; ; attempt++) {
      try {
        const store = await this.prisma.store.create({
          data: {
            ...dto,
            slug: suggestion.slug,
            sellerId,
            trialStartedAt: now,
            trialEndsAt,
            trialCreditRemainingToman: config.trialCreditToman,
          },
        });
        this.productEvents.log(
          'store_created',
          { storeId: store.id, userId: sellerId },
          { category: dto.category ?? null, hasCustomSlug: !!dto.slug && dto.slug === store.slug },
        );
        void this.recordTermsAcceptance(sellerId, now);
        return store;
      } catch (err) {
        if (!isSlugUniqueConflict(err) || attempt >= 5) {
          if (isSlugUniqueConflict(err)) throw new ConflictException(fa.store.slugTaken);
          throw err;
        }
        triedSlugs.add(suggestion.slug);
        suggestion = await this.suggestSlug(dto.name, dto.slug, triedSlugs);
      }
    }
  }

  // SP-2 §4.11.5 — «با زدن بساز شرایط را می‌پذیری»؛ بهترین‌تلاش و بی‌صدا، تا اگر SQL ستون‌ها هنوز
  // اجرا نشده باشد ساخت فروشگاه نشکند
  private async recordTermsAcceptance(userId: string, at: Date): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { termsAcceptedAt: at, termsVersion: TERMS_VERSION },
      });
    } catch (err) {
      this.logger.warn(`terms acceptance not recorded: ${(err as Error).message}`);
    }
  }

  async resumeOnboarding(sellerId: string, storeId: string, dto: CreateStoreDto) {
    this.assertBankCardPair(dto);
    const store = await this.getOwned(sellerId, storeId);
    if (dto.slug && dto.slug !== store.slug) {
      const realConversations = await this.prisma.salesConversation.count({
        where: { storeId, isTest: false },
      });
      if (realConversations > 0) {
        throw new ConflictException(fa.store.slugLocked);
      }
      if (!(await this.isSlugAvailable(dto.slug))) {
        throw new ConflictException(fa.store.slugTaken);
      }
    }
    try {
      return await this.prisma.store.update({
        where: { id: storeId },
        data: {
          name: dto.name,
          category: dto.category,
          businessType: dto.businessType,
          ...(dto.slug ? { slug: dto.slug } : {}),
          ...(dto.instagramUrl !== undefined
            ? { instagramUrl: dto.instagramUrl }
            : {}),
          ...(dto.telegramUrl !== undefined
            ? { telegramUrl: dto.telegramUrl }
            : {}),
          ...(dto.websiteUrl !== undefined ? { websiteUrl: dto.websiteUrl } : {}),
          ...(dto.bankCardNumber
            ? {
                bankCardNumber: dto.bankCardNumber,
                bankOwnerName: dto.bankOwnerName,
              }
            : {}),
        },
      });
    } catch (err) {
      if (isSlugUniqueConflict(err)) {
        throw new ConflictException(fa.store.slugTaken);
      }
      throw err;
    }
  }

  private assertBankCardPair(dto: CreateStoreDto) {
    const hasCard = !!dto.bankCardNumber;
    const hasOwner = !!dto.bankOwnerName;
    if (hasCard !== hasOwner) {
      throw new BadRequestException(fa.store.bankCardInvalid);
    }
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — فیلدهای ساختاریافته (ارسال/مرجوعی/
  // معرفی برند/ساعت پاسخ‌گویی)؛ برخلاف create، این‌ها بعد از ثبت‌نام هم قابل ویرایش‌اند
  async update(sellerId: string, storeId: string, dto: UpdateStoreDto) {
    const before = await this.getOwned(sellerId, storeId);
    const { source, ...data } = dto;
    // SP-2 §4.9 — تغییر slug فقط تا قبل از اولین گفتگوی واقعی (همان قاعده‌ی resumeOnboarding)
    if (data.slug !== undefined && data.slug !== before.slug) {
      const realConversations = await this.prisma.salesConversation.count({
        where: { storeId, isTest: false },
      });
      if (realConversations > 0) {
        throw new ConflictException(fa.store.slugLocked);
      }
      if (!(await this.isSlugAvailable(data.slug))) {
        throw new ConflictException(fa.store.slugTaken);
      }
    }
    // docs/PRD-leadgen-store-rich-brand-intro.md — فروشگاه‌های leadCaptureOnly کاتالوگ ندارند،
    // پس برندینترو تنها جای همیشه-حاضر برای یک اسکریپت فروش واقعی است؛ برای بقیه‌ی فروشگاه‌ها
    // همان سقف قبلی (۳۰۰) می‌ماند تا هزینه‌ی توکن هر نوبت برای اکثریت فروشگاه‌ها بالا نرود
    if (data.brandIntro !== undefined) {
      const maxLen = before.leadCaptureOnly ? 2000 : 300;
      if (data.brandIntro.length > maxLen) {
        throw new BadRequestException(fa.validation.stringTooLong);
      }
    }
    // R3.3 — بازه‌ی روز ارسال: هر دو یا هیچ‌کدام، 1 ≤ min ≤ max؛ مقدار نامشخص از مقدار فعلی پر می‌شود
    if (
      data.shippingDaysMin !== undefined ||
      data.shippingDaysMax !== undefined
    ) {
      const min =
        data.shippingDaysMin !== undefined
          ? data.shippingDaysMin
          : (before.shippingDaysMin ?? null);
      const max =
        data.shippingDaysMax !== undefined
          ? data.shippingDaysMax
          : (before.shippingDaysMax ?? null);
      if (!isValidShippingDays(min, max)) {
        throw new BadRequestException(fa.store.shippingDaysInvalid);
      }
    }
    // SP-7 — اولین روش پرداخت: لینک اسنپ‌پی (کارت در StoreBankCardService ثبت می‌شود)
    const addingSnapppay = !!data.snapppayPaymentLink && !(await this.storeHasPaymentMethod(before));
    let updated;
    try {
      updated = await this.prisma.store.update({
        where: { id: storeId },
        data,
      });
    } catch (err) {
      if (isSlugUniqueConflict(err)) {
        throw new ConflictException(fa.store.slugTaken);
      }
      throw err;
    }
    if (addingSnapppay) {
      this.productEvents.log('payment_method_added', { storeId, userId: sellerId }, { kind: 'snapppay' });
    }
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
    const { specs: rawSpecs, via, status: rawStatus, ...rest } = dto;
    const status = rawStatus ?? 'ACTIVE';
    const specs = clampProductSpecs(rawSpecs ?? undefined) ?? Prisma.DbNull;
    const trackStock = rest.trackStock ?? true;
    // stockSetAt: فقط وقتی موجودی صریحاً فرستاده شد (فرق «۰ واقعی» با «هنوز ننوشته»)
    const stockSetAt = rest.stock !== undefined ? new Date() : null;
    if (status === 'ACTIVE') {
      this.assertReadyToPublish({
        name: rest.name ?? '',
        basePrice: rest.basePrice ?? 0,
        pricingModel: rest.pricingModel ?? 'FIXED',
        trackStock,
        hasVariants: false,
        stockSetAt,
      });
    }
    const isFirstActiveProduct =
      status === 'ACTIVE' && (await this.countActiveProducts(storeId)) === 0;
    const created = await this.prisma.product.create({
      data: { ...rest, specs, storeId, status, stockSetAt },
    });
    if (status === 'DRAFT') {
      this.productEvents.log('product_draft_created', { storeId, userId: sellerId }, { via: via ?? 'single' });
    } else {
      this.productEvents.log(
        'product_published',
        { storeId, userId: sellerId },
        { via: via ?? 'legacy', first: isFirstActiveProduct },
      );
    }
    return { ...created, isFirstActiveProduct };
  }

  private countActiveProducts(storeId: string): Promise<number> {
    return this.prisma.product.count({ where: { storeId, status: 'ACTIVE' } });
  }

  // SP-3 — {code:'PRODUCT_NOT_READY', missing[]}؛ فرانت فیلدهای ناقص را فارسی نشان می‌دهد
  private assertReadyToPublish(candidate: PublishCandidate): void {
    const missing = missingForPublish(candidate);
    if (missing.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PRODUCT_NOT_READY',
        missing,
        message: fa.store.productNotReady,
      });
    }
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

  // کل کاتالوگ (انتخاب‌گرهای پنل، بات فروشنده)؛ لیست صفحه‌ی محصولات از listProductsPage می‌آید
  // SP-3/S5 — بدون status: فعال + مخفی (پیش‌نویس/آرشیو در انتخاب‌گرها نمی‌آید)؛ با status: همان یکی
  async listProducts(sellerId: string, storeId: string, status?: ListableProductStatus) {
    await this.getOwned(sellerId, storeId);
    return this.findProductsWithCompleteness(
      storeId,
      undefined,
      status ? [status] : ['ACTIVE', 'HIDDEN'],
    );
  }

  // R3.2 — cursor pagination برای صفحه‌ی لیست محصولات
  async listProductsPage(
    sellerId: string,
    storeId: string,
    page: { cursor?: string; limit: number },
    status: ListableProductStatus = 'ACTIVE',
  ) {
    await this.getOwned(sellerId, storeId);
    const [rows, grouped] = await Promise.all([
      this.findProductsWithCompleteness(storeId, page, [status]),
      this.prisma.product.groupBy({
        by: ['status'],
        where: { storeId, status: { in: ['ACTIVE', 'DRAFT', 'HIDDEN'] } },
        _count: { _all: true },
      }),
    ]);
    const counts = { ACTIVE: 0, DRAFT: 0, HIDDEN: 0 };
    for (const g of grouped) {
      if (g.status in counts) counts[g.status as ListableProductStatus] = g._count._all;
    }
    const items = rows.slice(0, page.limit);
    return {
      items,
      nextCursor:
        rows.length > page.limit ? items[items.length - 1].id : null,
      counts,
    };
  }

  private async findProductsWithCompleteness(
    storeId: string,
    page?: { cursor?: string; limit: number },
    statuses: ListableProductStatus[] = ['ACTIVE', 'HIDDEN'],
  ) {
    const products = await this.prisma.product.findMany({
      where: { storeId, status: { in: statuses } },
      orderBy: page
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : { createdAt: 'desc' },
      ...(page
        ? {
            take: page.limit + 1,
            ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
          }
        : {}),
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
    const stockAlertCounts = await this.stockAlerts.openCountsByProduct(storeId);
    return products.map((product) => ({
      ...product,
      stockAlertCount: stockAlertCounts.get(product.id) ?? 0,
      completeness: computeProductCompleteness(
        {
          ...product,
          hasVariants: product.optionTypes.length > 0,
          hasZeroStockVariants:
            product.trackStock &&
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
    opts: { q?: string; page: number; pageSize: number; ids?: string[] },
  ) {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store || store.status !== 'ACTIVE')
      throw new NotFoundException(fa.store.notFound);

    const where: Prisma.ProductWhereInput = {
      storeId: store.id,
      ...BUYER_VISIBLE,
      ...(opts.q ? { name: { contains: opts.q, mode: 'insensitive' } } : {}),
      ...(opts.ids ? { id: { in: opts.ids } } : {}),
    };
    const [items, total, shippingRules] = await Promise.all([
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
          trackStock: true,
          images: true,
          videos: true,
          description: true,
          pricingModel: true,
          weightGrams: true,
          purityKarat: true,
          goldWageType: true,
          goldWageValue: true,
          goldProfitPercent: true,
          optionTypes: {
            orderBy: { position: 'asc' },
            select: {
              name: true,
              values: {
                orderBy: { position: 'asc' },
                select: { value: true },
              },
            },
          },
          variants: {
            select: {
              id: true,
              optionValues: true,
              stock: true,
              priceOverride: true,
            },
          },
        },
      }),
      this.prisma.product.count({ where }),
      store.requiresShipping
        ? this.prisma.storeShippingRule.findMany({
            where: { storeId: store.id, enabled: true },
            select: { cost: true },
          })
        : Promise.resolve([] as { cost: number }[]),
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
    const reviewRows =
      items.length === 0
        ? []
        : await this.prisma.productComment.groupBy({
            by: ['productId'],
            where: {
              storeId: store.id,
              status: 'ADMIN_APPROVED',
              productId: { in: items.map((product) => product.id) },
            },
            _avg: { rating: true },
            _count: { _all: true },
          });
    const reviewByProduct = new Map(
      reviewRows.flatMap((row) =>
        row.productId
          ? [
              [
                row.productId,
                {
                  reviewCount: row._count._all,
                  ratingAvg:
                    row._avg.rating == null
                      ? null
                      : Math.round(Number(row._avg.rating) * 10) / 10,
                },
              ] as const,
            ]
          : [],
      ),
    );
    const shippingCosts = shippingRules.map((rule) => rule.cost);
    const shippingEstimate =
      shippingCosts.length === 0
        ? null
        : {
            minCostToman: Math.min(...shippingCosts),
            maxCostToman: Math.max(...shippingCosts),
          };

    return {
      items: items.map((p) => {
        const {
          pricingModel,
          weightGrams,
          purityKarat,
          goldWageType,
          goldWageValue,
          goldProfitPercent,
          optionTypes,
          trackStock,
          variants: rawVariants,
          ...publicFields
        } = p;
        // SP-3 — «همیشه موجود»: همه‌ی مدل‌ها موجودند و عددی نمایش داده نمی‌شود (فرانت فقط stock>0 می‌بیند)
        const variants = trackStock
          ? rawVariants
          : rawVariants.map((v) => ({ ...v, stock: UNLIMITED_STOCK }));
        if (!trackStock) publicFields.stock = UNLIMITED_STOCK;
        // محصول واریانت‌دار: موجودی واقعی جمع ترکیب‌هاست، Product.stock معنی ندارد
        else if (optionTypes.length > 0) {
          publicFields.stock = variants.reduce((n, v) => n + v.stock, 0);
        }
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
        // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۸.۱ — فیدبک کاربر
        // ۱۴۰۵/۰۷/۲۰: اجرت/کارمزد تا امروز حتی از این پاسخ عمومی هم حذف می‌شد، یعنی خریدار و
        // ایجنت فروش هیچ‌وقت نمی‌توانستند آن را ببینند. درصدهای خام را عمداً برنمی‌گردانیم —
        // همان خط فارسی آماده‌ی describeGoldPricing که در چت هم استفاده می‌شود، یکدست‌تر است
        const goldPricingSummary =
          pricingModel === 'WEIGHT_BASED_FORMULA'
            ? describeGoldPricing(
                {
                  weightGrams,
                  purityKarat,
                  goldWageType,
                  goldWageValue,
                  goldProfitPercent,
                },
                store,
              )
            : null;
        const reviews = reviewByProduct.get(p.id);
        return {
          ...publicFields,
          videos: parseProductVideos(p.videos),
          isWeightBasedPricing: pricingModel === 'WEIGHT_BASED_FORMULA',
          weightGrams,
          purityKarat,
          goldPricingSummary,
          basePrice: displayPrice,
          priceUnavailable,
          options: optionTypes.map((option) => ({
            name: option.name,
            values: option.values.map((value) => value.value),
          })),
          variants: variants.map((variant) => ({
            id: variant.id,
            options: asStringRecord(variant.optionValues),
            stock: variant.stock,
            price:
              pricingModel === 'WEIGHT_BASED_FORMULA'
                ? null
                : (variant.priceOverride ?? displayPrice),
          })),
          ratingAvg: reviews?.ratingAvg ?? null,
          reviewCount: reviews?.reviewCount ?? 0,
        };
      }),
      total,
      page: opts.page,
      pageSize: opts.pageSize,
      shippingEstimate,
      // R3.3 — «معمولاً ۲–۴ روز کاری ارسال می‌شه»؛ فقط برای فروشگاه‌هایی که کالای فیزیکی ارسال می‌کنند
      shippingDaysText: store.requiresShipping
        ? formatShippingDays(store.shippingDaysMin, store.shippingDaysMax)
        : null,
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
  private async storeHasPaymentMethod(store: {
    id: string;
    bankCardNumber: string | null;
    bankOwnerName: string | null;
    snapppayPaymentLink: string | null;
  }) {
    if (store.snapppayPaymentLink) return true;
    if (store.bankCardNumber && store.bankOwnerName) return true;
    const activeCards = await this.prisma.storeBankCard.count({
      where: { storeId: store.id, isActive: true },
    });
    return activeCards > 0;
  }

  async getCompleteness(sellerId: string, storeId: string) {
    const store = await this.getOwned(sellerId, storeId);
    const products = await this.prisma.product.findMany({
      where: { storeId, status: 'ACTIVE' },
      select: {
        id: true,
        images: true,
        description: true,
        trackStock: true,
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
              p.trackStock &&
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
        hasShippingPolicy:
          !!store.shippingInfo ||
          (store.shippingDaysMin != null && store.shippingDaysMax != null),
        // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۳.۳ — گسترش چک‌لیست
        // (قبلاً فقط hasShippingPolicy)؛ همه‌ی این فیلدها از قبل روی Store هستند، بدون کوئری اضافه
        hasReturnPolicy: !!store.returnPolicy,
        hasBrandIntro: !!store.brandIntro,
        hasOwnerNotes: !!store.ownerNotes,
        hasWorkingHours: !!(store.workingHoursStart && store.workingHoursEnd),
        hasPaymentMethod: await this.storeHasPaymentMethod(store),
      },
      // SP-6 — کارت «۳ قدم تا اولین فروش»؛ products همین‌جا فقط ACTIVE است
      launch: {
        hasActiveProduct: products.length > 0,
        hasPaymentMethod: await this.storeHasPaymentMethod(store),
        shared: !!store.launchSharedAt,
      },
    };
  }

  // SP-6 — idempotent؛ اولین بار launchSharedAt ست می‌شود، هر بار رویداد ثبت می‌شود
  async markLaunchShared(sellerId: string, storeId: string) {
    const store = await this.getOwned(sellerId, storeId);
    if (!store.launchSharedAt) {
      await this.prisma.store.updateMany({
        where: { id: storeId, launchSharedAt: null },
        data: { launchSharedAt: new Date() },
      });
    }
    this.productEvents.log('shop_link_shared', { storeId, userId: sellerId });
    return { ok: true as const };
  }

  // SP-7 / §4.12.1 — فقط آمار اشتراک لینک محصول
  async logProductLinkShared(sellerId: string, storeId: string, productId: string, channel: 'native' | 'copy' | 'telegram') {
    await this.getOwnedProduct(sellerId, storeId, productId);
    this.productEvents.log('product_link_shared', { storeId, userId: sellerId }, { productId, channel });
    return { ok: true as const };
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۳.۳/۳.۴ — موضوعات
  // تکرارشونده‌ای که ربات گیر کرده (AGENT_STUCK/SUPPORT_NEEDED) یا مشتری صریح خواسته انسان
  // (CUSTOMER_REQUESTED، همراه دلیل آزاد)، خوشه‌بندی‌شده با یک فراخوان LLM؛ برای تب «توجه».
  // نتیجه روی خود Store کش می‌شود (ATTENTION_SUGGESTIONS_TTL_MS) چون تولیدش یک فراخوان LLM
  // است و نباید با هر بار باز شدن تب دوباره محاسبه شود
  // SP-6 — کش قبلاً آرایه‌ی ساده بود؛ حالا {topics, dismissedTopics}. هر دو شکل خوانده می‌شود
  private readAttentionCache(raw: unknown): {
    topics: AttentionSuggestionTopic[];
    dismissedTopics: string[];
  } {
    if (Array.isArray(raw)) return { topics: raw as AttentionSuggestionTopic[], dismissedTopics: [] };
    const obj = (raw ?? {}) as { topics?: AttentionSuggestionTopic[]; dismissedTopics?: string[] };
    return { topics: obj.topics ?? [], dismissedTopics: obj.dismissedTopics ?? [] };
  }

  async getAttentionSuggestions(sellerId: string, storeId: string) {
    const store = await this.getOwned(sellerId, storeId);
    const cached = this.readAttentionCache(store.attentionSuggestions);
    const isFresh =
      !!store.attentionSuggestionsComputedAt &&
      Date.now() - store.attentionSuggestionsComputedAt.getTime() <
        ATTENTION_SUGGESTIONS_TTL_MS;
    if (isFresh) {
      return {
        topics: cached.topics.filter((t) => !cached.dismissedTopics.includes(t.topic)),
        computedAt: store.attentionSuggestionsComputedAt,
      };
    }

    const computed = await this.computeAttentionSuggestionTopics(storeId);
    const topics = computed.filter((t) => !cached.dismissedTopics.includes(t.topic));
    const computedAt = new Date();
    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        attentionSuggestions: {
          topics,
          dismissedTopics: cached.dismissedTopics,
        } as unknown as Prisma.InputJsonValue,
        attentionSuggestionsComputedAt: computedAt,
      },
    });
    return { topics, computedAt };
  }

  // SP-6 — «جواب بده» انجام شد؛ همان topic (با رشته‌ی دقیق) از کش حذف و در dismissedTopics
  // (آخرین ۵۰ تا) نگه داشته می‌شود تا محاسبه‌ی بعدی دوباره نشانش ندهد
  async dismissAttentionTopic(sellerId: string, storeId: string, topic: string) {
    const store = await this.getOwned(sellerId, storeId);
    const cached = this.readAttentionCache(store.attentionSuggestions);
    const dismissedTopics = [...cached.dismissedTopics.filter((t) => t !== topic), topic].slice(-50);
    const topics = cached.topics.filter((t) => t.topic !== topic);
    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        attentionSuggestions: { topics, dismissedTopics } as unknown as Prisma.InputJsonValue,
      },
    });
    return { topics };
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

    const attempt = async (model: string) => {
      const { object } = await generateObject({
        model: this.aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(model),
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
    };

    try {
      return await attempt(defaultModel());
    } catch (err) {
      // فیدبک کاربر ۱۴۰۵/۰۷/۲۱ — قبل از تسلیم، DEFAULT_MODEL_FALLBACK_CHAIN را امتحان کن؛
      // فقط اگر همه (از جمله این‌ها) شکست خوردند همان خطای اصلی را دوباره throw کن تا رفتار
      // قبلی (propagate به caller) حفظ شود، نه یک [] ساکت/گمراه‌کننده
      const chained = await withDefaultModelFallbackChain(attempt);
      if (chained) return chained;
      throw err;
    }
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
    // SP-3 — انتقال وضعیت: برگشت به DRAFT مجاز نیست؛ هر انتقال به ACTIVE اعتبارسنجی انتشار دارد
    let isFirstActiveProduct = false;
    if (dto.status === 'DRAFT' && before.status !== 'DRAFT') {
      throw new BadRequestException(fa.store.productBackToDraft);
    }
    const becomingActive = dto.status === 'ACTIVE' && before.status !== 'ACTIVE';
    if (becomingActive) {
      const variantCount = await this.prisma.productVariant.count({ where: { productId } });
      this.assertReadyToPublish({
        name: dto.name ?? before.name,
        basePrice: dto.basePrice ?? before.basePrice,
        pricingModel: dto.pricingModel ?? before.pricingModel,
        trackStock: dto.trackStock ?? before.trackStock,
        hasVariants: variantCount > 0,
        stockSetAt: dto.stock !== undefined ? new Date() : before.stockSetAt,
      });
      isFirstActiveProduct = (await this.countActiveProducts(storeId)) === 0;
    }
    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        ...rest,
        ...(specs !== undefined ? { specs } : {}),
        ...(dto.stock !== undefined ? { stockSetAt: new Date() } : {}),
      },
    });
    if (becomingActive) {
      this.productEvents.log(
        'product_published',
        { storeId, userId: sellerId },
        { via: 'single', first: isFirstActiveProduct },
      );
    }
    if (dto.stock !== undefined && before.stock <= 0 && updated.stock > 0) {
      void this.stockAlerts
        .notifyRestocked([
          {
            productId,
            variantId: null,
            previous: before.stock,
            next: updated.stock,
          },
        ])
        .catch((err) =>
          this.logger.error(`stock alert failed (product=${productId})`, err),
        );
    }
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
    return { ...updated, isFirstActiveProduct };
  }

  // SP-5/S4 — انتشار گروهی پیش‌نویس‌ها؛ هر محصول مستقل (یکی ناقص بقیه را نمی‌گیرد)
  async publishProducts(sellerId: string, storeId: string, ids: string[]) {
    await this.getOwned(sellerId, storeId);
    const unique = [...new Set(ids)].slice(0, 50);
    const rows = await this.prisma.product.findMany({
      where: { id: { in: unique }, storeId },
      include: { _count: { select: { variants: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const published: string[] = [];
    const failed: { id: string; missing: string[] }[] = [];
    let activeCount = await this.countActiveProducts(storeId);
    for (const id of unique) {
      const row = byId.get(id);
      if (!row) {
        failed.push({ id, missing: ['not_found'] });
        continue;
      }
      if (row.status === 'ACTIVE') {
        published.push(id);
        continue;
      }
      if (row.status === 'ARCHIVED') {
        failed.push({ id, missing: ['not_found'] });
        continue;
      }
      const missing = missingForPublish({
        name: row.name,
        basePrice: row.basePrice,
        pricingModel: row.pricingModel,
        trackStock: row.trackStock,
        hasVariants: row._count.variants > 0,
        stockSetAt: row.stockSetAt,
      });
      if (missing.length > 0) {
        failed.push({ id, missing });
        continue;
      }
      await this.prisma.product.update({ where: { id }, data: { status: 'ACTIVE' } });
      this.productEvents.log(
        'product_published',
        { storeId, userId: sellerId },
        { via: 'batch', first: activeCount === 0 },
      );
      activeCount++;
      published.push(id);
    }
    return { published, failed };
  }

  // SP-5/§4.12.3 — «یکی مثل این بساز»: پیش‌نویس تازه با همان مشخصات (بدون عکس/ویدیو/نظرات/کد/sku)
  async duplicateProduct(sellerId: string, storeId: string, productId: string) {
    await this.getOwnedProduct(sellerId, storeId, productId);
    const src = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        optionTypes: { orderBy: { position: 'asc' }, include: { values: { orderBy: { position: 'asc' } } } },
        variants: true,
      },
    });
    if (!src) throw new NotFoundException(fa.store.productNotFound);
    const copy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          storeId,
          name: `${src.name} (کپی)`.slice(0, 200),
          basePrice: src.basePrice,
          pricingModel: src.pricingModel,
          weightGrams: src.weightGrams,
          purityKarat: src.purityKarat,
          goldWageType: src.goldWageType,
          goldWageValue: src.goldWageValue,
          goldProfitPercent: src.goldProfitPercent,
          description: src.description,
          specs: src.specs ?? Prisma.DbNull,
          trackStock: src.trackStock,
          persuasionTechniquesEnabled: src.persuasionTechniquesEnabled,
          hasFulfillmentDelay: src.hasFulfillmentDelay,
          status: 'DRAFT',
          stock: 0,
          stockSetAt: null,
        },
      });
      for (const [i, option] of src.optionTypes.entries()) {
        await tx.productOptionType.create({
          data: {
            productId: created.id,
            name: option.name,
            position: i,
            values: { create: option.values.map((v, j) => ({ value: v.value, position: j })) },
          },
        });
      }
      for (const v of src.variants) {
        await tx.productVariant.create({
          data: {
            productId: created.id,
            optionValues: v.optionValues as Prisma.InputJsonValue,
            stock: 0,
            priceOverride: v.priceOverride,
            weightGrams: v.weightGrams,
            purityKarat: v.purityKarat,
          },
        });
      }
      return created;
    });
    this.productEvents.log('product_duplicated', { storeId, userId: sellerId }, { from: productId });
    return copy;
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
      const comboKey = variantComboKey(variant.optionValues);
      if (combosSeen.has(comboKey)) {
        throw new BadRequestException(fa.store.variantCombinationDuplicate);
      }
      combosSeen.add(comboKey);
    }

    const restocked = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.productVariant.findMany({
        where: { productId },
        select: { id: true, optionValues: true, stock: true },
      });
      const plan = planVariantSync(existing, dto.variants);
      await tx.productOptionType.deleteMany({ where: { productId } });
      for (const [i, option] of dto.optionTypes.entries()) {
        await tx.productOptionType.create({
          data: {
            productId,
            name: option.name,
            position: i,
            values: {
              create: option.values.map((value, j) => ({ value, position: j })),
            },
          },
        });
      }
      for (const update of plan.updates) {
        const variant = dto.variants[update.index];
        await tx.productVariant.update({
          where: { id: update.id },
          data: {
            optionValues: variant.optionValues,
            ...(variant.stock === undefined ? {} : { stock: variant.stock }),
            priceOverride: variant.priceOverride ?? null,
            sku: variant.sku ?? null,
            weightGrams: variant.weightGrams ?? null,
            purityKarat: variant.purityKarat ?? null,
          },
        });
      }
      for (const index of plan.creates) {
        const variant = dto.variants[index];
        await tx.productVariant.create({
          data: {
            productId,
            optionValues: variant.optionValues,
            stock: variant.stock ?? 0,
            priceOverride: variant.priceOverride ?? null,
            sku: variant.sku ?? null,
            weightGrams: variant.weightGrams ?? null,
            purityKarat: variant.purityKarat ?? null,
          },
        });
      }
      if (plan.deleteIds.length > 0) {
        await tx.productVariant.deleteMany({
          where: { id: { in: plan.deleteIds } },
        });
      }
      // SP-3 — موجودی مدل‌ها نوشته شد؛ برای اعتبارسنجی انتشار
      await tx.product.update({
        where: { id: productId },
        data: { stockSetAt: new Date() },
      });
      return plan.updates.flatMap((update) => {
        const before = existing.find((row) => row.id === update.id);
        const variant = dto.variants[update.index];
        if (!before || variant.stock === undefined || before.stock === variant.stock) {
          return [];
        }
        return [
          {
            productId,
            variantId: update.id,
            previous: before.stock,
            next: variant.stock,
          },
        ];
      });
    });
    void this.stockAlerts
      .notifyRestocked(restocked)
      .catch((err) =>
        this.logger.error(`stock alert failed (product=${productId})`, err),
      );

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
        // 2.6 — SSRF: رد IP خصوصی/لینک‌لوکال/metadata، سقف ۵MB هنگام دانلود (نه بعد از آن)
        const res = await safeFetch(url, {
          timeoutMs: 10_000,
          maxBytes: 5 * 1024 * 1024,
        });
        const contentType = res.contentType;
        if (
          res.status < 200 ||
          res.status >= 300 ||
          !contentType.startsWith('image/')
        ) {
          continue;
        }
        const buffer = res.body;
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
    // 0.13a — کلید باید واقعاً جزو عکس‌های همین محصول باشد؛ وگرنه فروشنده می‌تواند هر فایل
    // باکت مشترک (عکس فروشگاه‌های دیگر، رسیدها) را پاک کند
    if (!product.images.includes(key))
      throw new NotFoundException(fa.store.productNotFound);
    const remaining = product.images.filter((k) => k !== key);
    await this.storage.deleteObject(key).catch(() => undefined);
    return this.prisma.product.update({
      where: { id: productId },
      data: { images: remaining },
    });
  }

  // SP-4 — «کاور کن»: عکس انتخاب‌شده اول آرایه می‌رود (عکس اول = کاور)
  async setProductCoverImage(sellerId: string, storeId: string, productId: string, key: string) {
    const product = await this.getOwnedProduct(sellerId, storeId, productId);
    if (!product.images.includes(key)) throw new NotFoundException(fa.store.productNotFound);
    return this.prisma.product.update({
      where: { id: productId },
      data: { images: [key, ...product.images.filter((k) => k !== key)] },
    });
  }

  // SP-4 — یک محصول برای صفحه‌ی ویرایش (پیش‌نویس هم)، با همان شکل لیست (گزینه‌ها/مدل‌ها/تکمیل‌بودن)
  async getProductForSeller(sellerId: string, storeId: string, productId: string) {
    await this.getOwnedProduct(sellerId, storeId, productId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        optionTypes: { orderBy: { position: 'asc' }, include: { values: { orderBy: { position: 'asc' } } } },
        variants: true,
      },
    });
    if (!product) throw new NotFoundException(fa.store.productNotFound);
    return product;
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
    const existingVideos = parseProductVideos(product.videos);
    // 0.13a — مثل removeProductImage: کلید بیگانه هرگز از باکت حذف نشود
    if (!existingVideos.some((v) => v.key === key))
      throw new NotFoundException(fa.store.productNotFound);
    const videos = existingVideos.filter((v) => v.key !== key);
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

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۲۰.۳ — روی Darkube هیچ
  // shell/ترمینالی داخل کانتینر بک‌اند پروداکشن در دسترس نیست، پس تنها راه اتصال عکس/فیلم به
  // محصولات قالب دمو از بیرون همین سه متد (پشت ApiKeyGuard در DemoProductsAdminController)
  // است. عمداً به‌جای sellerId، store.isDemoTemplate چک می‌شود — حتی با لو رفتن کلید، محصول
  // واقعی یک فروشنده دست‌نخورده می‌ماند (این متد هرگز چیزی جز فروشگاه‌های قالب را برنمی‌گرداند)
  private async getDemoTemplateProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { store: true },
    });
    if (!product || !product.store.isDemoTemplate) {
      throw new NotFoundException(fa.store.productNotFound);
    }
    return product;
  }

  async listDemoTemplateProducts() {
    return this.prisma.product.findMany({
      where: { store: { isDemoTemplate: true } },
      select: {
        id: true,
        name: true,
        images: true,
        videos: true,
        store: { select: { slug: true } },
      },
      orderBy: [{ store: { slug: 'asc' } }, { createdAt: 'asc' }],
    });
  }

  // همون اعتبارسنجی addProductImages بالا (سقف ۴ تا، فقط image/*، حداکثر ۵ مگابایت — سقف
  // واقعی اینترسپتور کنترلر)، فقط چک مالکیت فرق دارد
  async addDemoProductImage(productId: string, file: Express.Multer.File) {
    const product = await this.getDemoTemplateProduct(productId);
    if (product.images.length + 1 > StoreService.MAX_PRODUCT_IMAGES) {
      throw new BadRequestException(fa.store.tooManyImages);
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException(fa.store.imageOnly);
    }
    const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const key = await this.storage.uploadImage(file.buffer, ext);
    return this.prisma.product.update({
      where: { id: productId },
      data: { images: { push: key } },
    });
  }

  // همون اعتبارسنجی/نرمال‌سازی uploadProductVideo بالا (mp4/mov با magic bytes، سقف ۴ تا،
  // حداکثر ۵۰ مگابایت، حداکثر ۹۰ ثانیه)، فقط چک مالکیت فرق دارد
  async addDemoProductVideo(productId: string, file: Express.Multer.File) {
    const product = await this.getDemoTemplateProduct(productId);
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
    const notes: { row: number; message: string }[] = [];

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
        // SP-3 — خانه‌ی موجودی خالی ← «همیشه موجود» (نه ۰ بی‌صدا که محصول را غیرقابل‌فروش می‌کرد)
        const blankStock = instance.stock === undefined || instance.stock === null || Number.isNaN(instance.stock);
        await this.prisma.product.create({
          data: {
            ...instance,
            stock: blankStock ? 0 : instance.stock,
            trackStock: !blankStock,
            stockSetAt: blankStock ? null : new Date(),
            status: 'ACTIVE',
            specs: undefined,
            storeId,
          },
        });
        if (blankStock) notes.push({ row: rowNumber, message: fa.store.importBlankStockNote });
        created++;
      } catch {
        errors.push({ row: rowNumber, message: 'خطا در ذخیره‌سازی این ردیف' });
      }
    }

    if (created > 0) {
      this.productEvents.log('product_published', { storeId, userId: sellerId }, { via: 'import', first: false, count: created });
    }
    return { created, errors, notes };
  }

  // docs/PRD-mvp-launch-plan.md گام ۱ — حداقلی، بدون UI: فروشنده باید بتواند سفارش‌های
  // در انتظار تایید را ببیند/تایید/رد کند تا حلقه‌ی سفارش با curl قابل تست باشد؛ صف کامل
  // با نمایش تصویر رسید در پنل موبایل، گام ۳ است.
  // 3.4/3.5 — `q`: کد سفارش (کامل یا بخشی از آن، حداقل ۲ نویسه؛ پیشوند NV اختیاری)، شماره
  // (دقیق یا ۴ رقم آخر) یا نام خریدار/گیرنده. جست‌وجو فقط داخل سفارش‌های همین فروشگاه است.
  private buildOrderSearchFilter(q?: string): Prisma.OrderWhereInput {
    const text = q?.trim();
    if (!text) return {};
    const or: Prisma.OrderWhereInput[] = [];
    const code = normalizeOrderCodeInput(text);
    if (code) {
      or.push({ orderCode: code });
    } else {
      const partial = normalizeOrderCodePartialInput(text);
      if (partial) or.push({ orderCode: { contains: partial } });
    }
    const digits = toEnglishDigits(text).replace(/\D/g, '');
    if (
      digits.length >= 4 &&
      digits.length <= 13 &&
      digits === toEnglishDigits(text).replace(/[\s+-]/g, '')
    ) {
      const tail = digits.length >= 10 ? digits.slice(-10) : digits;
      or.push({ recipientPhone: { endsWith: tail } });
      or.push({ conversation: { customer: { phone: { endsWith: tail } } } });
    }
    or.push({ recipientName: { contains: text, mode: 'insensitive' } });
    or.push({
      conversation: {
        customer: { fullName: { contains: text, mode: 'insensitive' } },
      },
    });
    return { OR: or };
  }

  // کل لیست (بات فروشنده استفاده می‌کند)؛ پنل وب از listOrdersPage استفاده می‌کند
  async listOrders(
    sellerId: string,
    storeId: string,
    status?: OrderStatus,
    q?: string,
  ) {
    await this.getOwned(sellerId, storeId);
    return this.findOrdersWithImages(storeId, status, q);
  }

  // R3.2 — cursor pagination؛ ترتیب پایدار (createdAt, id) تا سفارش‌های هم‌زمان جابه‌جا نشوند
  async listOrdersPage(
    sellerId: string,
    storeId: string,
    status: OrderStatus | OrderStatus[] | undefined,
    q: string | undefined,
    page: { cursor?: string; limit: number },
  ) {
    await this.getOwned(sellerId, storeId);
    const rows = await this.findOrdersWithImages(storeId, status, q, page);
    const items = rows.slice(0, page.limit);
    return {
      items,
      nextCursor:
        rows.length > page.limit ? items[items.length - 1].id : null,
    };
  }

  private async findOrdersWithImages(
    storeId: string,
    status?: OrderStatus | OrderStatus[],
    q?: string,
    page?: { cursor?: string; limit: number },
  ) {
    const orders = await this.prisma.order.findMany({
      where: {
        storeId,
        conversation: { isTest: false },
        // SP-6 — لیست وضعیت‌ها (فیلتر «ارسال شده» = SHIPPED+DELIVERED)
        ...(Array.isArray(status)
          ? status.length > 0
            ? { status: { in: status } }
            : {}
          : status
            ? { status }
            : {}),
        ...this.buildOrderSearchFilter(q),
      },
      orderBy: page
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : { createdAt: 'desc' },
      ...(page
        ? {
            take: page.limit + 1,
            ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
          }
        : {}),
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
          variantId?: string;
          variantLabel?: string;
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

  async approveOrder(
    sellerId: string,
    storeId: string,
    orderId: string,
    channel: OrderChannel = 'WEB',
  ) {
    const order = await this.getOwnedOrder(sellerId, storeId, orderId);
    // فیدبک کاربر — فروشنده باید بتواند بعد از رد اشتباهی، سفارش را دوباره تایید کند
    // (REJECTED → APPROVED در ماشین وضعیت مجاز است). 3.2 — تایید دوگانه (وب + بات، دبل‌کلیک)
    // فقط یک اثر دارد: OrderStateService زیر قفل ردیف کار می‌کند و دستور دوم changed=false می‌گیرد
    const r = await this.orderState.transition({
      orderId,
      to: 'APPROVED',
      actor: 'SELLER',
      actorId: sellerId,
      channel,
    });
    if (!r.changed) return { ...r.order, stockWarnings: [] };
    // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۲.۲ — برای
    // سفارش‌های تحویل‌زمان‌بر، درخواست نظر به لحظه‌ی «ارسال شد» موکول می‌شود (shipOrder)
    if (!order.hasFulfillmentDelay) {
      await this.requestReviewFollowUp(order);
    }
    return { ...r.order, stockWarnings: r.stockWarnings };
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
    channel: OrderChannel = 'WEB',
    refundAmountToman?: number,
    moneyReceived?: boolean,
  ) {
    const order = await this.getOwnedOrder(sellerId, storeId, orderId);
    const needsMoneyAnswer =
      order.status === 'RECEIPT_SUBMITTED' ||
      order.status === 'APPROVED' ||
      !!order.receiptImageKey;
    if (needsMoneyAnswer && moneyReceived === undefined) {
      throw new BadRequestException(fa.order.moneyReceivedRequired);
    }
    const r = await this.orderState.transition({
      orderId,
      to: 'REJECTED',
      actor: 'SELLER',
      actorId: sellerId,
      channel,
      data: {
        rejectReason: reason ?? null,
        ...(refundAmountToman != null ? { refundAmountToman } : {}),
        ...(moneyReceived !== undefined ? { moneyReceived } : {}),
      },
    });
    return r.order;
  }

  async deliverOrder(
    sellerId: string,
    storeId: string,
    orderId: string,
    channel: OrderChannel = 'WEB',
  ) {
    await this.getOwnedOrder(sellerId, storeId, orderId);
    const r = await this.orderState.transition({
      orderId,
      to: 'DELIVERED',
      actor: 'SELLER',
      actorId: sellerId,
      channel,
    });
    return r.order;
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۳.۲ — ارسال: فقط از
  // APPROVED (shipOrder روی PENDING/REJECTED دیگر مجاز نیست — 3.2)؛ شرکت حمل و کد رهگیری (3.5)
  async shipOrder(
    sellerId: string,
    storeId: string,
    orderId: string,
    shipment?: { carrier?: string; trackingCode?: string },
    channel: OrderChannel = 'WEB',
  ) {
    const order = await this.getOwnedOrder(sellerId, storeId, orderId);
    if (
      shipment?.carrier &&
      !(ORDER_CARRIERS as readonly string[]).includes(shipment.carrier)
    ) {
      throw new BadRequestException(fa.order.carrierInvalid);
    }
    const r = await this.orderState.transition({
      orderId,
      to: 'SHIPPED',
      actor: 'SELLER',
      actorId: sellerId,
      channel,
      data: {
        carrier: shipment?.carrier ?? null,
        trackingCode: shipment?.trackingCode?.trim() || null,
      },
    });
    if (!r.changed) return r.order;
    // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۲.۲ — برای سفارش‌های
    // تحویل‌زمان‌بر، اولین باری که باید درخواست نظر فرستاده شود همین لحظه است
    if (order.hasFulfillmentDelay) {
      await this.requestReviewFollowUp(order);
    }
    return r.order;
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

    // 0.13k — مرز روز با Asia/Tehran (قبلاً UTC: «امروز» از ۰۳:۳۰ تهران شروع می‌شد)
    const todayStart = startOfTehranDay();
    const weekStart = addTehranDays(todayStart, -6);
    const monthStart = addTehranDays(todayStart, -29);

    const [approvedOrders, orderCountsByStatus, orderCountsByPaymentMethod] =
      await Promise.all([
        this.prisma.order.findMany({
          // 0.7 — «ارسال» سفارش را از درآمد حذف نمی‌کرد‌ ولی فقط APPROVED شمرده می‌شد
          where: {
            storeId,
            status: { in: [...SUCCESSFUL_ORDER_STATUSES] },
            conversation: { isTest: false },
          },
          select: {
            totalAmount: true,
            createdAt: true,
            approvedAt: true,
            items: true,
            conversation: { select: { customerId: true } },
          },
        }),
        this.prisma.order.groupBy({
          by: ['status'],
          where: { storeId, conversation: { isTest: false } },
          _count: { _all: true },
        }),
        this.prisma.order.groupBy({
          by: ['paymentMethod'],
          where: { storeId, conversation: { isTest: false } },
          _count: { _all: true },
        }),
      ]);

    // 0.13k — درآمد بر اساس زمان تایید (approvedAt)، نه ثبت سفارش؛ ردیف‌های قدیمی بدون approvedAt
    // به createdAt برمی‌گردند
    const revenueAt = (o: { approvedAt: Date | null; createdAt: Date }) =>
      o.approvedAt ?? o.createdAt;
    const sumSince = (since: Date) =>
      approvedOrders
        .filter((o) => revenueAt(o) >= since)
        .reduce((sum, o) => sum + o.totalAmount, 0);

    const dailyRevenueTrend: { date: string; totalToman: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = addTehranDays(todayStart, -i);
      const nextDay = addTehranDays(day, 1);
      const totalToman = approvedOrders
        .filter((o) => revenueAt(o) >= day && revenueAt(o) < nextDay)
        .reduce((sum, o) => sum + o.totalAmount, 0);
      dailyRevenueTrend.push({
        date: tehranDateString(day),
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
      DELIVERED: 0,
      CANCELLED: 0,
    };
    for (const row of orderCountsByStatus) {
      countByStatus[row.status] = row._count._all;
    }

    const countByPaymentMethod: Record<OrderPaymentMethod, number> = {
      CARD_TO_CARD: 0,
      SNAPPPAY: 0,
    };
    for (const row of orderCountsByPaymentMethod) {
      countByPaymentMethod[row.paymentMethod] = row._count._all;
    }

    return {
      revenueTodayToman: sumSince(todayStart),
      revenueWeekToman: sumSince(weekStart),
      revenueMonthToman: sumSince(monthStart),
      orderCountsByStatus: countByStatus,
      orderCountsByPaymentMethod: countByPaymentMethod,
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
      where: { storeId, conversation: { isTest: false } },
      orderBy: { createdAt: 'desc' },
    });
    const lines = [fa.store.csvOrdersHeader.map(csvEscape).join(',')];
    for (const order of orders) {
      const items = order.items as {
        name: string;
        qty: number;
        variantLabel?: string;
      }[];
      const productNames = items
        .map(
          (i) =>
            `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.qty}`,
        )
        .join(' + ');
      lines.push(
        [
          order.createdAt.toLocaleDateString('fa-IR'),
          productNames,
          order.totalAmount.toLocaleString('fa-IR'),
          fa.store.csvOrderStatusLabels[order.status] ?? order.status,
          fa.store.csvPaymentMethodLabels[order.paymentMethod] ??
            order.paymentMethod,
          order.shippingProvince ?? '',
          order.shippingAddress ?? '',
          order.postalCode ?? '',
          order.recipientName ?? '',
          order.recipientPhone ?? '',
          order.shippingCostToman?.toLocaleString('fa-IR') ?? '',
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
      this.prisma.product.findMany({
        where: { storeId, status: { in: ['ACTIVE', 'HIDDEN'] } },
        include: { optionTypes: { select: { id: true } }, variants: true },
      }),
      this.prisma.order.findMany({
        where: {
          storeId,
          status: 'APPROVED',
          conversation: { isTest: false },
        },
        select: { items: true },
      }),
    ]);
    // فروش‌رفته هم به تفکیک ترکیب (کلید productId یا productId:variantId) هم جمع کل محصول
    const soldQty = new Map<string, number>();
    const bump = (key: string, qty: number) =>
      soldQty.set(key, (soldQty.get(key) ?? 0) + qty);
    for (const order of approvedOrders) {
      const items = order.items as {
        productId: string;
        variantId?: string;
        qty: number;
      }[];
      for (const item of items) {
        bump(item.productId, item.qty);
        if (item.variantId)
          bump(`${item.productId}:${item.variantId}`, item.qty);
      }
    }
    const variantLabel = (optionValues: unknown): string =>
      Object.entries(optionValues as Record<string, string>)
        .map(([k, v]) => `${k}: ${v}`)
        .join('، ');
    const lines = [fa.store.csvProductsHeader.map(csvEscape).join(',')];
    for (const product of products) {
      // محصول واریانت‌دار: یک ردیف به‌ازای هر ترکیب (موجودی/قیمت/فروش خود ترکیب)؛
      // Product.stock برایش معنی ندارد
      const rows =
        product.optionTypes.length > 0 && product.variants.length > 0
          ? product.variants.map((v) => [
              product.name,
              variantLabel(v.optionValues),
              (v.priceOverride ?? product.basePrice).toLocaleString('fa-IR'),
              product.trackStock ? v.stock : fa.store.csvUnlimited,
              soldQty.get(`${product.id}:${v.id}`) ?? 0,
            ])
          : [
              [
                product.name,
                '',
                product.basePrice.toLocaleString('fa-IR'),
                product.trackStock ? product.stock : fa.store.csvUnlimited,
                soldQty.get(product.id) ?? 0,
              ],
            ];
      for (const row of rows) lines.push(row.map(csvEscape).join(','));
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

  // R2.1 — شمارنده‌های سبک برای نشان‌های نوار پنل (جایگزین بار کردن کل لیست محصولات/مکالمه‌ها فقط برای شمردن)
  async getBadges(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    const overdueBefore = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const [receipts, conversations, issues, refundsOverdue, lowStockRows, weightProducts] =
      await Promise.all([
        this.prisma.order.count({
          where: {
            storeId,
            status: 'RECEIPT_SUBMITTED',
            conversation: { isTest: false },
          },
        }),
        this.prisma.salesConversation.count({
          where: { storeId, isMutedForHuman: true, isTest: false },
        }),
        this.prisma.orderIssue.count({
          where: {
            status: 'OPEN',
            order: { storeId, conversation: { isTest: false } },
          },
        }),
        this.prisma.orderRefund.count({
          where: {
            storeId,
            status: { in: ['AWAITING_DESTINATION', 'READY'] },
            createdAt: { lte: overdueBefore },
            order: { conversation: { isTest: false } },
          },
        }),
        this.prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM (
            SELECT p.id
            FROM products p
            LEFT JOIN product_variants v ON v."productId" = p.id
            WHERE p."storeId" = ${storeId}
              AND p.status = 'ACTIVE' AND p."trackStock" = true
            GROUP BY p.id, p.stock
            HAVING (COUNT(v.id) = 0 AND p.stock <= ${LOW_STOCK_BADGE_THRESHOLD})
                OR (COUNT(v.id) > 0 AND MIN(v.stock) <= ${LOW_STOCK_BADGE_THRESHOLD})
          ) t
        `,
        // نوار قیمت طلا فقط وقتی لازم است که محصول وزنی داشته باشد؛ با pagination لیست محصولات دیگر از روی لیست قابل تشخیص نیست
        this.prisma.product.count({
          where: { storeId, status: 'ACTIVE', pricingModel: 'WEIGHT_BASED_FORMULA' },
        }),
      ]);
    return {
      receipts,
      attention: conversations,
      issues,
      refundsOverdue,
      lowStock: Number(lowStockRows[0]?.count ?? 0),
      hasWeightProducts: weightProducts > 0,
    };
  }

  async listToday(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    const take = 20;
    const overdueBefore = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const [receipts, toShip, conversations, refunds, issues, lowStockRows, waitingRows] =
      await Promise.all([
        this.prisma.order.findMany({
          where: {
            storeId,
            status: 'RECEIPT_SUBMITTED',
            conversation: { isTest: false },
          },
          orderBy: { updatedAt: 'desc' },
          take,
          select: {
            id: true,
            orderCode: true,
            receiptVerifiedMatch: true,
            totalAmount: true,
            updatedAt: true,
            receiptImageKey: true,
            conversation: { select: { customer: { select: { phone: true, fullName: true } } } },
          },
        }),
        this.prisma.order.findMany({
          where: {
            storeId,
            status: 'APPROVED',
            conversation: { isTest: false },
          },
          orderBy: { updatedAt: 'desc' },
          take,
          select: { id: true, orderCode: true },
        }),
        this.prisma.salesConversation.findMany({
          where: { storeId, isMutedForHuman: true, isTest: false },
          orderBy: { updatedAt: 'desc' },
          take,
          include: { customer: true },
        }),
        this.prisma.orderRefund.findMany({
          where: {
            storeId,
            status: { in: ['AWAITING_DESTINATION', 'READY'] },
            createdAt: { lte: overdueBefore },
            order: { conversation: { isTest: false } },
          },
          orderBy: { createdAt: 'asc' },
          take,
          include: { order: { select: { id: true, orderCode: true } } },
        }),
        this.prisma.orderIssue.findMany({
          where: {
            status: 'OPEN',
            order: { storeId, conversation: { isTest: false } },
          },
          orderBy: { createdAt: 'desc' },
          take,
          include: { order: { select: { id: true, orderCode: true } } },
        }),
        this.prisma.$queryRaw<{ id: string; name: string; stock: number }[]>`
          SELECT p.id, p.name,
            (CASE WHEN COUNT(v.id) = 0 THEN p.stock ELSE MIN(v.stock) END)::int AS stock
          FROM products p
          LEFT JOIN product_variants v ON v."productId" = p.id
          WHERE p."storeId" = ${storeId}
            AND p.status = 'ACTIVE' AND p."trackStock" = true
          GROUP BY p.id, p.name, p.stock
          HAVING (COUNT(v.id) = 0 AND p.stock <= 2)
              OR (COUNT(v.id) > 0 AND MIN(v.stock) <= 2)
          ORDER BY stock ASC, p.name ASC
          LIMIT ${take}
        `,
        this.prisma.productStockAlert.groupBy({
          by: ['productId'],
          where: { storeId, notifiedAt: null },
          _count: { _all: true },
        }),
      ]);

    // یک کوئری برای آخرین پیام مشتری همه‌ی گفتگوهای منتظر (نه N+1)
    const lastMessages = new Map<string, string>();
    if (conversations.length > 0) {
      const rows = await this.prisma.$queryRaw<{ conversationId: string; text: string | null }[]>`
        SELECT DISTINCT ON ("conversationId") "conversationId", payload->>'text' AS text
        FROM conversation_events
        WHERE type = 'CUSTOMER_MESSAGE'
          AND "conversationId" IN (${Prisma.join(conversations.map((c) => c.id))})
        ORDER BY "conversationId", "createdAt" DESC
      `;
      for (const row of rows) {
        if (row.text) lastMessages.set(row.conversationId, row.text.slice(0, 80));
      }
    }

    const waitingIds = waitingRows
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, take);
    const waitingProducts = waitingIds.length
      ? await this.prisma.product.findMany({
          where: { id: { in: waitingIds.map((row) => row.productId) } },
          select: { id: true, name: true },
        })
      : [];
    const waitingName = new Map(waitingProducts.map((row) => [row.id, row.name]));
    const lowStock = lowStockRows.map((row) => ({
      id: row.id,
      name: row.name,
      stock: Number(row.stock),
    }));
    const awaitingRestock = waitingIds.map((row) => ({
      id: row.productId,
      name: waitingName.get(row.productId) ?? '',
      openAlerts: row._count._all,
    }));

    return {
      receipts: receipts.map((order) => ({
        id: order.id,
        orderCode: displayOrderCode(order),
        receiptVerifiedMatch: order.receiptVerifiedMatch,
        // SP-6 — کارت رسید در «امروز» (تایید/رد همان‌جا)
        amountToman: order.totalAmount,
        customerLabel:
          order.conversation?.customer?.fullName ??
          order.conversation?.customer?.phone ??
          'مشتری ناشناس',
        submittedAt: order.updatedAt,
        hasReceiptImage: !!order.receiptImageKey,
      })),
      toShip: toShip.map((order) => ({
        id: order.id,
        orderCode: displayOrderCode(order),
      })),
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        customerLabel:
          conversation.customer.phone ??
          conversation.customer.fullName ??
          'مشتری ناشناس',
        // SP-6 — آخرین پیام مشتری (≤۸۰ کاراکتر) و «از کی منتظر»؛ updatedAt تقریب زمان بی‌صدا شدن است
        lastCustomerMessage: lastMessages.get(conversation.id) ?? null,
        waitingSince: conversation.updatedAt,
      })),
      refunds: refunds.map((refund) => ({
        id: refund.id,
        orderId: refund.order.id,
        orderCode: displayOrderCode(refund.order),
        amountToman: refund.amountToman,
      })),
      issues: issues.map((issue) => ({
        id: issue.id,
        orderId: issue.order.id,
        orderCode: displayOrderCode(issue.order),
        reason: issue.reason,
      })),
      lowStock,
      awaitingRestock,
    };
  }

  async listNeededAttention(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    const conversations = await this.prisma.salesConversation.findMany({
      where: { storeId, isMutedForHuman: true, isTest: false },
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
    before?: string,
  ) {
    const conversation = await this.getOwnedConversation(
      sellerId,
      storeId,
      conversationId,
    );
    const { events, hasMoreEvents } = await getRecentConversationEvents(
      this.prisma,
      conversationId,
      before,
    );
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
      hasMoreEvents,
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
    // 0.8 — پیام فروشنده = takeover: AI از این به بعد ساکت می‌شود (قبلاً فروشنده جواب می‌داد و
    // AI هم به پیام بعدی خریدار جواب می‌داد). «برگشت به بات» = unmute
    if (!conversation.isMutedForHuman) {
      await this.prisma.$transaction([
        this.prisma.salesConversation.update({
          where: { id: conversationId },
          data: { isMutedForHuman: true },
        }),
        this.prisma.conversationEvent.create({
          data: {
            conversationId,
            type: 'SYSTEM',
            payload: { kind: 'SELLER_TAKEOVER' },
          },
        }),
      ]);
    }
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
  // 0.8 — قطع دستی AI برای یک مکالمه (فروشنده می‌خواهد خودش ادامه بدهد، بدون ارسال پیام)
  async muteConversation(
    sellerId: string,
    storeId: string,
    conversationId: string,
  ) {
    await this.getOwnedConversation(sellerId, storeId, conversationId);
    return this.prisma.salesConversation.update({
      where: { id: conversationId },
      data: { isMutedForHuman: true },
    });
  }

  async unmuteConversation(
    sellerId: string,
    storeId: string,
    conversationId: string,
  ) {
    await this.getOwnedConversation(sellerId, storeId, conversationId);
    // 1.3 — اگر فروشگاه حالا اعتبار دارد، مکالمات BLOCKED آن (از جمله همین مکالمه) دوباره PAID
    // می‌شوند؛ وگرنه «برگشت به بات» دوباره handoff و هشدار تکراری می‌داد
    await this.creditDeduction
      .reevaluateBlockedConversations(storeId)
      .catch((err) =>
        this.logger.error(
          `reevaluateBlockedConversations failed (store=${storeId})`,
          err,
        ),
      );
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

function isSlugUniqueConflict(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  if ((err as { code?: string }).code !== 'P2002') return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) {
    return target.some((item) => String(item).includes('slug'));
  }
  return typeof target === 'string' && target.includes('slug');
}
