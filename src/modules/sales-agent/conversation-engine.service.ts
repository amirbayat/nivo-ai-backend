import {
  buildCorrectiveInstruction,
  extractNumbers,
  findSuspiciousPriceClaims,
  sanitizeQuickReplies,
  validateReply,
  type Violation,
} from './sales-machine/reply-validator';
import {
  buildPerceptionPrompt,
  neutralPerception,
  perceptionSchema,
  sanitizePerception,
  type Perception,
} from './sales-machine/perception.schema';
import {
  applyPerception,
  decideSalesTurn,
  deriveLeadFunnelStage,
  recordAgentTurn,
} from './sales-machine/sales-stage-reducer';
import {
  hoursBetween,
  loadSalesMemory,
  summarizeCart,
} from './sales-machine/sales-memory.util';
import {
  buildChatMessages,
  type HistoryEntry,
} from './sales-machine/chat-messages';
import {
  EVIDENCE_GOALS,
  buildSalesActSystemPrompt,
} from './sales-machine/sales-act-prompt';
import { contractFor } from './sales-machine/sales-playbook';
import type {
  SalesDecision,
  SalesMemory,
  ServerFacts,
  TurnGoal,
} from './sales-machine/sales-machine.types';
import { getSalesAgentGlobalConfig } from './sales-agent-global-config.util';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { OrderStateService } from '../order-lifecycle/order-state.service';
import { OrderNotificationService } from '../order-lifecycle/order-notification.service';
import { ReceiptCheckService } from '../order-lifecycle/receipt-check.service';
import { approvalEtaLabel } from '../order-lifecycle/order-ops.service';
import { maskPaymentSecrets } from '../../common/utils/payment-secret-mask.util';
import {
  ORDER_CODE_MAX_ATTEMPTS,
  displayOrderCode,
  generateOrderCode,
} from '../../common/utils/order-code.util';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import {
  generateObject,
  generateText,
  tool,
  stepCountIs,
  type UserModelMessage,
} from 'ai';
import {
  currentShopTurnId,
  emitShopReplace,
  generateShopTurn,
  runOutsideShopTurn,
} from './shop-turn-stream';
import { z } from 'zod';
import type {
  ConversationState,
  LeadFunnelStage,
  Order,
  OrderPaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BUYER_VISIBLE,
  applyUntrackedStock,
  availableQty,
} from '../store/product-visibility';
import { ProductEventService } from '../../common/analytics/product-event.service';
import { StorageService } from '../../storage/storage.service';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { IRAN_PROVINCES } from '../../common/constants/iran-provinces';
import { toEnglishDigits } from '../../common/utils/normalize-digits';
import {
  validateAddressForm,
  normalizeIranMobile,
  type AddressFormResult,
} from '../../common/utils/address-form.util';
import { StoreKbService } from '../store/store-kb.service';
import { CardSelectorService } from '../store/card-selector.service';
import { MarketPricesService } from '../market-prices/market-prices.service';
import {
  computeDisplayPrice,
  describeGoldPricing,
  GoldPriceUnavailableError,
  GoldPricingNotConfiguredError,
} from '../store/product-pricing.util';
import {
  parseProductVideos,
  type ProductVideoItem,
} from '../store/product-video.types';
import {
  parseProductSpecs,
  formatSpecsForFacts,
  type ProductSpecItem,
} from '../store/product-specs.types';
import { CreditService } from './credit.service';
import { CreditAlertService } from './credit-alert.service';
import { AbuseGuardService } from './abuse-guard.service';
import { normalizeLeadPhone } from '../../common/utils/lead-phone';
import { SellerBotApiClientService } from '../seller-bot/seller-bot-api-client.service';
import { CommentsService } from '../comments/comments.service';
import { formatShippingRulesSummary } from './shipping-rules-summary.util';
import { formatShippingDays } from '../../common/utils/shipping-days.util';
import { fa } from '../../i18n/fa';
import {
  defaultModel,
  PERCEPTION_MODEL,
  resolveModel,
  DEFAULT_MODEL_FALLBACK_CHAIN,
  withDefaultModelFallbackChain,
  pickVariant,
  pickVoiceVariant,
  pickResponseStrategy,
} from './model-variants';
import { toneForCategory } from './tone-by-category';
import {
  buildIntentClassificationPrompt,
  intentClassificationSchema,
} from './intent-classification.schema';
import type {
  AddressSnapshot,
  AiTraceData,
  BuyerNeedTag,
  CartItem,
  ConversationContext,
  CustomerState,
  EngineResult,
  ParsedIntent,
  PendingVariantSelection,
  PersuasionTechnique,
  SalesAction,
  SalesAgentVoiceJobData,
  UiBlock,
} from './sales-agent.types';
import { ConversationLockService } from './conversation-lock.service';
import { NotificationService } from '../notifications/notification.service';
import {
  CART_MAX_QTY_PER_LINE,
  CONVERSATION_DRAIN_MAX_ROUNDS,
  CREDIT_ALERT_DEDUPE_TTL_SECONDS,
  LLM_FALLBACK_MAX_MODELS,
  LLM_MAX_RETRIES,
  ORDER_PAYMENT_WINDOW_HOURS,
} from '../../common/constants/sales-ops.constants';
import {
  LlmSaturatedError,
  isLlmSaturated,
  runLlmTurn,
} from '../../common/services/llm-turn-guard';
import { setLogCtx } from '../../common/logging/log-context';
import { formatTomanAmountsInText, stripUnauthorizedPriceSentences } from '../../common/utils/fa-amounts.util';
import { isValidCartQty, reconcileCart, lineKey } from './cart-validation.util';
import type { CatalogLine } from './cart-validation.util';
import { getAceContext, setCallSite } from '../../common/ai-cost-engine/ace-context';
import { aceActive, aceOn, aceParams, aceShadow, resolveEngineMode } from '../../common/ai-cost-engine/ace-config';
import { normalizeFa } from './answer-engine/normalize';
import { aceNote, aceTraceInfo } from '../../common/ai-cost-engine/ace-context';
import { pushShadow } from '../../common/ai-cost-engine/shadow/shadow-store';
import { buildSignature } from './answer-engine/signature';
import { isContextDependent } from './answer-engine/context-dependence';
import { composeFastAnswer, eligibleForFastAnswer } from './answer-engine/fast-answers';
import { eligibleToLookup, eligibleToStore, semanticLookup, semanticMaybeStore } from './answer-engine/semantic-cache';
import { briefInputHash } from '../store/product-brief/brief-hash';
import { BRIEF_PROMPT_RULE, isBriefUsable, readSections, renderBriefFacts, type BriefRow } from '../store/product-brief/brief-prompt';
import { normalizeDescription } from '../store/product-brief/normalize';
import { loopDietPrepareStep } from './loop-diet';
import { PROMPT_CACHE_BREAK } from '../../common/ai-cost-engine/prompt-cache';
import { ProductFinderService } from './product-finder/product-finder.service';
import {
  buildFinderItem,
  buildLastSearch,
  type LastSearch,
  buildZeroHint,
  describeLastSearch,
  nextPageExcludeIds,
  priceMismatch,
  STRUCTURED_SEARCH_RULES,
} from './product-finder/finder-output';
import {
  buildSearchDescription,
  buildSearchInputSchema,
  GENERIC_SEARCH_PROFILE,
  isQueryOnly,
  sortLabel,
  appliedOf,
  toFinderSpec,
  type FinderSpec,
  type StoreSearchProfile,
} from './product-finder/finder-spec';
import { DEMO_FAKE_CARD_NUMBER, DEMO_FAKE_CARD_OWNER, isNivoLeadStore } from '../../common/utils/store-mode';
import { touchConversation } from './conversation-touch.util';

export type ConversationWithStore = Prisma.SalesConversationGetPayload<{
  include: { store: true };
}>;

type ConsultationProduct = Awaited<ReturnType<ConversationEngineService['searchProductsForConsultation']>>[number];

type ProductLike = {
  id: string;
  name: string;
  basePrice: number;
  stock: number;
  // SP-3 — false = «همیشه موجود»؛ resolveProductPrices موجودی را به UNLIMITED_STOCK می‌برد
  trackStock?: boolean;
  // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲.۳ — basePrice برای
  // WEIGHT_BASED_FORMULA نادیده گرفته می‌شود؛ resolveProductPrices قبل از هر مصرف این را
  // با قیمت محاسبه‌شده‌ی لحظه‌ای overwrite می‌کند. اختیاری چون بعضی select های محدود
  // (مثل tryAnswerFromProductDescriptions) این فیلدها را اصلاً نمی‌خوانند و نیازی هم ندارند
  pricingModel?: 'FIXED' | 'WEIGHT_BASED_FORMULA';
  weightGrams?: number | null;
  purityKarat?: number | null;
  // فیدبک کاربر ۱۴۰۵/۰۷/۱۴ — اجرت/سود اختصاصی این محصول؛ null/undefined = از پیش‌فرض فروشگاه
  goldWageType?: 'PERCENT' | 'FIXED_PER_GRAM' | null;
  goldWageValue?: number | null;
  goldProfitPercent?: number | null;
  // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۸.۱ — resolveProductPrices
  // این را هم‌زمان با basePrice پر می‌کند؛ خط فارسی آماده‌ی «وزن/عیار/اجرت/سود/مالیات»، برای
  // تزریق به واقعیت‌های مدل و نمایش در کارت محصول، تا دیگر این داده‌ها بعد از محاسبه‌ی قیمت دور ریخته نشوند
  goldPricingSummary?: string | null;
  images: string[];
  description?: string | null;
  // docs/PRD-product-video.md بخش ۴ — ستون Json خام (Prisma.JsonValue)، با parseProductVideos می‌خوانیم
  videos?: unknown;
  // docs/PRD-seller-knowledge-base.md بخش ۹.۲ (سوم) — ستون Json خام، با parseProductSpecs می‌خوانیم
  specs?: unknown;
  // docs/PRD-product-display-focus-and-variations.md §۴ — فقط وقتی کوئری با VARIANT_INCLUDE
  // گرفته شده پر است؛ نبودن/خالی‌بودن یعنی محصول ساده (بدون گزینه) است
  optionTypes?: ProductOptionTypeWithValues[];
  variants?: ProductVariantRow[];
};

// docs/PRD-product-display-focus-and-variations.md §۴ — شکل include مشترک همه‌جایی که محصول
// برای نمایش/افزودن‌به‌سبد خوانده می‌شود (searchProducts، doUpdateCart، handleAction، showProduct
// caller ها)؛ یک‌جا تعریف شده تا هیچ مسیری فراموش نشود که optionTypes/variants را بخواهد
export const PRODUCT_VARIANT_INCLUDE = {
  optionTypes: {
    orderBy: { position: 'asc' as const },
    include: { values: { orderBy: { position: 'asc' as const } } },
  },
  variants: true,
};

type ProductOptionTypeWithValues = {
  id: string;
  name: string;
  position: number;
  values: { id: string; value: string; position: number }[];
};

type ProductVariantRow = {
  id: string;
  optionValues: unknown;
  priceOverride: number | null;
  stock: number;
  // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۳.۴
  weightGrams?: number | null;
  purityKarat?: number | null;
};

// محصول با گزینه فعال است یعنی حداقل یک ProductOptionType دارد — خودِ وجود واریانت‌ها هم
// همین را نشان می‌دهد، ولی optionTypes منبع واقعی تصمیم است (ممکن است فروشنده گزینه ساخته
// ولی هنوز هیچ ردیف موجودی‌دار نساخته باشد)
// QA-15 — از پیام‌های خریدار (جدیدترین اول) برای هر بُعد، مقداری را پیدا می‌کند که دقیقاً یکی از
// مقدارهای همان بُعد در متن آمده؛ اگر در یک پیام چند مقدار از یک بُعد آمد مبهم است و رد می‌شود.
// ارقام فارسی/عربی/لاتین یکسان‌اند و «۴ ساله» با مقدار «۴ سال» جور می‌شود (نه «۱۴ ساله»).
export function extractOptionValuesFromTexts(
  optionTypes: ReadonlyArray<{ name: string; values: ReadonlyArray<{ value: string }> }>,
  texts: readonly string[],
): Record<string, string> {
  const norm = (t: string) =>
    toEnglishDigits(t)
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/[‌\s]+/g, ' ')
      .trim()
      .toLowerCase();
  const normTexts = texts.map(norm);
  const found: Record<string, string> = {};
  for (const type of optionTypes) {
    for (const text of normTexts) {
      const hits = type.values.filter((v) => {
        const needle = norm(v.value);
        if (!needle) return false;
        let from = 0;
        for (;;) {
          const idx = text.indexOf(needle, from);
          if (idx === -1) return false;
          const before = idx > 0 ? text[idx - 1] : '';
          const startsWithDigit = /\d/.test(needle[0]);
          if (!(startsWithDigit && /\d/.test(before))) return true;
          from = idx + 1;
        }
      });
      if (hits.length === 1) {
        found[type.name] = hits[0].value;
        break;
      }
      if (hits.length > 1) break;
    }
  }
  return found;
}

function hasVariantOptions(product: Pick<ProductLike, 'optionTypes'>): boolean {
  return (product.optionTypes?.length ?? 0) > 0;
}

// مجموع موجودی همه‌ی ترکیب‌ها — برای PRODUCT_CARD/COMPARE_CARD وقتی محصول واریانت دارد،
// چون Product.stock خودش برای محصول واریانت‌دار دیگر معنی ندارد (تصمیم §۴)
function aggregateVariantStock(product: Pick<ProductLike, 'variants'>): number {
  return (product.variants ?? []).reduce((sum, v) => sum + v.stock, 0);
}

function displayStock(
  product: Pick<ProductLike, 'stock' | 'optionTypes' | 'variants'>,
): number {
  return hasVariantOptions(product)
    ? aggregateVariantStock(product)
    : product.stock;
}

// docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۸.۱ — goldPricingSummary
// یک ستون واقعی دیتابیس نیست (برخلاف weightGrams/purityKarat)؛ resolveProductPrices آن را
// in-place روی همان آبجکت Prisma می‌نشاند، اما تایپ استاتیک متغیر فراخوان‌کننده (مثل نتیجه‌ی
// findMany خام) هیچ‌وقت این فیلد را نمی‌شناسد. این تابع یک خواندن type-safe فراهم می‌کند بدون
// نیاز به cast پراکنده در همه‌جا — همان ترفند پارامتر optional روی ProductLike
function goldPricingSummaryOf(product: {
  id: string;
  goldPricingSummary?: string | null;
}): string | null {
  return product.goldPricingSummary ?? null;
}

// آستانه‌ی handoff: بعد از این تعداد پیام پیاپی نامفهوم/بی‌نتیجه، مکالمه به انسان سپرده
// می‌شود (طبق جدول دیسپچ پلن گام ۱) — تایمر ندارد، فقط شمارنده.
// فیدبک اول پایلوت: از ۲ به ۴ افزایش یافت — ۲ خیلی زود escalate می‌کرد، مخصوصاً وقتی خودِ
// دکمه‌های UI هم (قبل از فیکس handleAction) از مسیر NLU رد می‌شدند و گاهی نامفهوم تشخیص
// داده می‌شدند
const HANDOFF_CLARIFY_THRESHOLD = 4;

// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۲.۵ — سقف پیام خریدار در هر
// مکالمه‌ی دمو (store.isDemo)؛ چت واقعی = توکن واقعی مدل، این عدد جلوی هزینه‌ی نامحدود یک سشن
// دمو را می‌گیرد. فقط برای isDemo چک می‌شود، فروشگاه‌های واقعی اصلاً از این مسیر رد نمی‌شوند
const DEMO_MESSAGE_CAP = 25; // DEMO-2: یک خرید کامل با ۱۵ کم بود

// docs/PRD-sales-agent-voice.md بخش ۱.۳/۳ — آستانه‌ی طول پاسخ برای تولید وویس + سقف تعداد
// وویس به‌ازای هر مکالمه (جلوی مکالمه‌ای که هر پاسخش وویس می‌گیرد)
const VOICE_MIN_REPLY_CHARS = 200;
const VOICE_MAX_PER_CONVERSATION = 10;
// docs/PRD-sales-agent-voice.md بخش ۶.۳ — سقف وویس‌های پشت‌سرهم بدون یک پاسخ متنی‌تنها در میانه
const VOICE_MAX_CONSECUTIVE = 2;

// docs/PRD-sales-agent-voice.md بخش ۶.۲ — TTS پارامتر «حداکثر مدت» ندارد؛ با نرخ گفتار
// فارسی ~۱۴-۱۶ کاراکتر/ثانیه، ~۴۵۰ کاراکتر تقریباً معادل ۳۰ ثانیه است (تخمین اولیه، بعد
// از شنیدن نمونه‌ی واقعی قابل کالیبره‌شدن). متن ذخیره/نمایش‌داده‌شده کامل می‌ماند — فقط
// متنی که برای TTS صف می‌شود کوتاه می‌شود، و نه وسط جمله.
const VOICE_MAX_CHARS = 450;
const SENTENCE_END_CHARS = ['.', '!', '؟', '؛'];

function truncateForVoice(text: string): string {
  if (text.length <= VOICE_MAX_CHARS) return text;
  const window = text.slice(0, VOICE_MAX_CHARS);
  let cutAt = -1;
  for (const ch of SENTENCE_END_CHARS) {
    const idx = window.lastIndexOf(ch);
    if (idx > cutAt) cutAt = idx;
  }
  if (cutAt > 0) return text.slice(0, cutAt + 1);
  const lastSpace = window.lastIndexOf(' ');
  return lastSpace > 0 ? text.slice(0, lastSpace) : window;
}

// فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — سقف ذخیره‌سازی description به ۵۰۰۰ کاراکتر بالا رفت (create/
// update-product.dto.ts)، ولی description تقریباً ۹۵٪+ توکن هر محصول در facts است و
// doBrowse() تا ۵ محصول را همزمان می‌فرستد؛ بدون این سقف، هزینه‌ی هر پاسخ AI به‌شدت بالا
// می‌رفت. فروشنده هرچقدر می‌خواهد می‌نویسد، ولی فقط این مقدار به مدل تزریق می‌شود.
const DESCRIPTION_FACTS_MAX_CHARS = 700;

// وقتی تمرکز روی «یک» محصول است (لینک مستقیم/فوکوس/getProductDetails) جدول سایز و موجودی
// معمولاً ته توضیحات است؛ با ۷۰۰ کاراکتر بریده می‌شد و ربات سایز پیشنهاد نمی‌داد.
const DESCRIPTION_FACTS_SINGLE_MAX_CHARS = 5000; // = سقف ذخیره‌سازی؛ یعنی توضیحات کامل
const DESCRIPTION_FACTS_FEW_MAX_CHARS = 2500;

// سقف بر اساس تعداد محصولِ همزمان در یک پاسخ: یک محصول = توضیحات کامل، ۲–۳ تا = متوسط،
// بیشتر (browse/کاتالوگ) = ۷۰۰ تا هزینه‌ی توکن بالا نرود
function descriptionMaxFor(productCount: number): number {
  if (productCount <= 1) return DESCRIPTION_FACTS_SINGLE_MAX_CHARS;
  if (productCount <= 3) return DESCRIPTION_FACTS_FEW_MAX_CHARS;
  return DESCRIPTION_FACTS_MAX_CHARS;
}

function truncateDescriptionForFacts(
  description: string,
  max = DESCRIPTION_FACTS_MAX_CHARS,
): string {
  if (description.length <= max) return description;
  return `${description.slice(0, max)}...`;
}

// docs/PRD-sales-agent-sales-state-machine.md §۱۵.۲ — وضعیت قابل‌تغییر یک نوبت FULL_AGENT؛
// جایگزین متغیرهای let پراکنده‌ی callFullAgentTurn تا ابزارها بیرون از آن ساخته شوند
type AgentTurnRuntime = {
  ctx: ConversationContext;
  mutationHappened: boolean;
  progressHappened: boolean;
  handoffResult: EngineResult | null;
  // فاز ۰ — نتیجه‌ی فلوی قطعی (آدرس/پرداخت/انتخاب واریانت) که نوبت را کوتاه می‌کند
  flowResult: EngineResult | null;
  cartResult: { cart: CartItem[]; total: number } | null;
  orderResult: {
    cardNumber: string;
    ownerName: string;
    amount: number;
  } | null;
  photosResult: {
    productId: string;
    productName: string;
    images: string[];
    videos: ProductVideoItem[];
  } | null;
  compareResult: {
    products: {
      id: string;
      name: string;
      basePrice: number;
      stock: number;
      specs: ProductSpecItem[];
    }[];
  } | null;
  seenProducts: Map<string, CompactProduct>;
  toolFetchedProductIds: Set<string>;
};

// docs/PRD-sales-agent-sales-state-machine.md §۴ — خروجی ادراک+تصمیم، یک‌بار در هر نوبت (نه در هر
// تلاش fallback مدل Act)
type PreparedSalesTurn = {
  memBefore: SalesMemory;
  mem: SalesMemory;
  perception: Perception;
  perceptionFailed: boolean;
  decision: SalesDecision;
  facts: ServerFacts;
  history: HistoryEntry[];
};

// §۶.۳
const PERCEPTION_TIMEOUT_MS = 8000;
// §۱۰.۳ — محصولات تا ۱۵٪ بالاتر از بودجه هنوز کاندیدند (مدل باید صادقانه «بالاتر از بودجه» بگوید)
const BUDGET_SOFT_CEILING = 1.15;
const MAX_CANDIDATES = 8;
// اهدافی که به نمونه‌ی کاتالوگ نیاز ندارند (صرفه‌جویی توکن)
const GOALS_WITHOUT_CATALOG_SAMPLE: TurnGoal[] = [
  'POST_PURCHASE_CARE',
  'SOFT_EXIT',
  'ASSIST_CHECKOUT',
];

// §۱۰.۵ — customerState و leadFunnelStage عمداً حذف شدند (مرحله را سرور تعیین می‌کند)
const salesRespondShape = {
  text: z
    .string()
    .describe('متن نهایی برای مشتری — طبق قرارداد پاسخ همین نوبت'),
  relevantProductIds: z
    .array(z.string())
    .describe('محصولاتی که در همین متن معرفی کردی؛ وگرنه خالی'),
  quickReplies: z
    .array(z.string())
    .max(3)
    .describe(
      '۰ تا ۳ گزینه‌ی کوتاه (حداکثر ۲۵ کاراکتر) که مشتری با یک لمس بفرستد؛ از زبان مشتری نوشته شود («مشکی رو میخوام»)',
    ),
  askedQuestion: z
    .string()
    .nullable()
    .describe('اگر در متن سؤالی پرسیدی، همان سؤال؛ وگرنه null'),
};

// §۱۳ — نسخه‌ی مسیر جدید buildLeadCaptureOnlyInstruction: بخش «مسیر تبدیل (CTA)» حذف شد (نقشش را
// هدف‌های نوبت گرفته‌اند)؛ فقط «سفارش ندارد»، «کاتالوگ خالی طبیعی است»، «۲-۳ ویژگی با ✅» و نگاشت
// بستن به capture_lead
function buildSalesLeadCaptureNote(): string {
  return `این فروشگاه حالت ثبت سفارش/پرداخت ندارد — هرگز ادعا نکن سفارشی ثبت شده یا قرار است پرداختی انجام شود؛ سبد و create_order اصلاً در اختیارت نیست.
این فروشگاه عمداً کاتالوگ محصول ندارد یا خیلی محدود است — اگر چیزی پیدا نشد هرگز نگو «محصولی نداریم»؛ طبق معرفی فروشگاه و باکس دانش درباره‌ی خودِ کسب‌وکار صحبت کن.
وقتی ویژگی‌های واقعی نیوو را می‌گویی، ۲-۳ ویژگی مشخص را هر کدام در یک خط جدا با ✅ بنویس؛ تعریف کلی و مبهم («ما بهترینیم») ممنوع، و هرگز عدد/درصد اختراع نکن.
اگر هدف نوبت «بستن» یا «اجرای خرید» است، به‌جای سبد: وقتی مشتری آماده بود یا گفت «ثبت‌نام می‌کنم»، capture_lead را صدا بزن؛ کارت ثبت‌نام (شماره و کد پیامکی) خودکار زیر پیام نمایش داده می‌شود. هرگز شماره را در متن نخواه و نگو «بهت زنگ می‌زنم»؛ فقط اگر مشتری خودش شماره‌اش را در پیام نوشت، همان را در phone بگذار. interest را با یک جمله‌ی کوتاه از نیاز مشتری پر کن. quickReplies برای بستن: «ثبت‌نام می‌کنم» و «اول یه سؤال دارم».`;
}

// findSuspiciousPriceClaims اکنون در sales-machine/reply-validator.ts است (docs/PRD-sales-agent-sales-state-machine.md
// §۱۱) تا هر دو مسیر یک منبع داشته باشند؛ مسیر فعلی همچنان فقط لاگ می‌کند

// docs/PRD-sales-agent-tool-calling-architecture.md بخش ۴.۳ — ثابت در کد، نه تنظیم قابل‌پیکربندی
// در پنل (طبق عادت این پروژه)؛ فقط با داده‌ی واقعی فاز ۳ کالیبره می‌شود
const OPEN_QUESTION_NUDGE_THRESHOLD = 3;

// docs/PRD-sales-agent-consultative-recommendation.md بخش ۳.۲ — همان آستانه و همان توجیه
// (کاتالوگ کوچک کامل در پرامپت جا می‌شود) که PRD-sales-agent-implicit-need-detection.md بخش ۳
// قبلاً برای رد embeddings/pgvector استدلال کرده بود؛ بالاتر از این سقف نیاز به retrieval واقعی دارد
const CONSULTATION_FULL_CATALOG_FALLBACK_CAP = 30;

// همون سند، بخش ۴.۴ — عمداً «نرم»: مدل همچنان آزاد است FAQ را جواب بدهد، فقط موظف است در
// همان پاسخ یک قدم به جلو هم اضافه کند؛ هرگز به مشتری اعلام محدودیت/امتناع از جواب نمی‌کند
// docs/PRD-full-agent-engineering-review.md بخش ۳.۱ — قبلاً هیچ قانون صریح اولویتی بین این
// دستورالعمل و قانون «حالت مشاوره» («اگر مطمئن نیستی سوال بپرس») بالا وجود نداشت؛ هر دو همزمان
// روی دقیقاً همان مشتری (متقاعدسازی روشن + نادج فعال + پیام نیازمحور مبهم) قابل‌فعال‌شدن بودند و
// با هم تناقض داشتند. تصمیم صریح: این دستورالعمل برنده می‌شود، ولی به‌جای حدس‌زدن/اختراع‌کردن یک
// محصول نامرتبط، باید از search_products برای پیداکردن نزدیک‌ترین محصول واقعی به کل بحث استفاده
// شود — نه سکوت/امتناع، ولی نه حدس کورکورانه هم.
const OPEN_QUESTION_NUDGE_INSTRUCTION = `مشتری چند پیام پشت‌سرهم فقط سوال اطلاعاتی پرسیده بدون
نزدیک‌شدن به تصمیم خرید. این دستورالعمل روی قانون «اگر مطمئن نیستی سوال بپرس» در بخش «حالت مشاوره»
بالا اولویت دارد: دیگر وقت سوال‌پرسیدن تمام شده. اگر هنوز دنبال محصول مناسب نگشته‌ای، همین الان
search_products را با بهترین خلاصه‌ای که از کل بحث تا الان داری صدا بزن؛ بعد از نتیجه، یک محصول
واقعی و مشخص (مرتبط‌ترین نتیجه‌ی واقعی، نه یک حدس) را با توضیح کوتاهِ چرا به بحث مرتبط است معرفی کن
و صریح دعوت به اضافه‌کردن به سبد کن — حتی اگر مشتری دوباره فقط سوال پرسیده. هرگز نگو سوالاتت تموم
شده یا از جواب‌دادن امتناع نکن؛ فقط مکالمه را به‌سمت یک تصمیم مشخص هدایت کن.`;

// فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — نسخه‌ی معادل OPEN_QUESTION_NUDGE_INSTRUCTION بالا، مخصوص فروشگاه‌های
// leadCaptureOnly: آن یکی حول search_products/سبد است که این‌جا اصلاً وجود ندارد (دقیقاً همان
// دلیلی که leadCaptureOnly از nudgeActive بالا مستثنی شده — نگاه کن به توضیح کنار محاسبه‌ی
// nudgeActive/leadCaptureNudgeActive پایین‌تر). دیده‌شده در ترنسکریپت واقعی: مشتری چندین پیام
// پشت‌سرهم علاقه/سؤال نشان می‌دهد («آره بگو»، سؤال قیمت) ولی مدل هر بار فقط همان معرفی/ویژگی‌ها را
// با کلمات کمی متفاوت تکرار می‌کند و هیچ‌وقت واقعاً capture_lead را صدا نمی‌زند یا شماره نمی‌خواهد.
// این دستورالعمل، بعد از N نوبت بدون پیشرفت واقعی (progressHappened سرور-محور، نه خوداظهاری)،
// صریحاً یک قدم عملی به سمت بستن فانل را اجباری می‌کند.
const LEAD_CAPTURE_NUDGE_THRESHOLD = 2;

const LEAD_CAPTURE_NUDGE_INSTRUCTION = `چند نوبت پشت‌سرهم مشتری علاقه/سؤال نشان داده ولی هنوز به
CTA (باز شدن کارت ثبت‌نام با capture_lead) نرسیده‌ای — دیگر وقت توضیح‌دادن دوباره‌ی همان ویژگی‌ها یا
پرسیدن یک سؤال اطلاعاتی تازه تمام شده. در همین پاسخ (بعد از جواب‌دادن به هر سؤال واقعی مشتری طبق
قانون «اول answer_faq» بالا، اگر چنین سؤالی مطرح شده)، حتماً یک قدم عملی به سمت بستن بردار: همین
الان capture_lead را صدا بزن تا کارت ثبت‌نام نمایش داده شود (شماره را در متن نخواه). دیگر صرفاً یک سؤال عمومی دیگر («بیشتر پیام‌هاتون از
دایرکته؟» و مشابه آن) نپرس و فقط ویژگی‌ها را دوباره بازگو نکن.`;

// فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — دو دستورالعمل استراتژی مبتنی بر CustomerState خودگزارش‌دهی‌شده
// (sales-agent.types.ts)، برای هر دو نوع فروشگاه. هر دو فقط وقتی فعال می‌شوند که تحلیل *نوبت
// قبل* مدل همین شرط را داشته باشد — یک فروشنده‌ی حرفه‌ای هیچ‌وقت به کسی که نمی‌تواند کمکش کند
// فشار نمی‌آورد، و هیچ‌وقت قبل از همدلی مستقیم می‌رود سراغ ویژگی/قیمت
const PAIN_NOT_SOLVABLE_INSTRUCTION = `طبق تحلیل خودت در نوبت قبل، دردی که مشتری دارد را این
فروشگاه/نیوو واقعاً نمی‌تواند حل کند (painSolvable=NO). از همین پاسخ دیگر هیچ فشار فروش یا دعوت به
CTA برای حل همین درد نده — صادقانه و مؤدبانه همین را بگو (مثلاً این دقیقاً کاری نیست که انجام
می‌دهیم)، و گفت‌وگو را با احترام جمع کن یا اگر لازم شد request_human_handoff بزن. هرگز برای بستن
فروش ادعای نادرست نساز. اگر پیام تازه‌ی مشتری نشان داد موضوع/نیاز عوض شده، این محدودیت را نادیده
بگیر و عادی ادامه بده.`;

const EMPATHY_MISSING_INSTRUCTION = `طبق تحلیل خودت در نوبت قبل، درد/نگرانی مشتری شناسایی شده ولی هنوز
واقعاً با او همدلی نکرده‌ای (empathyShown=false). قبل از هر معرفی ویژگی/قیمت/CTA در همین پاسخ، اول با
یک جمله‌ی کوتاه و واقعی (نه کلیشه‌ای) نشان بده که دردش را فهمیدی — بعد ادامه بده.`;

// فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — برخلاف سه مورد بالا (که قبل از تولید پاسخ، به پرامپت اضافه می‌شوند)،
// این دو مخصوص یک retry اصلاحی *بعد از* تولید پاسخ‌اند — وقتی خودِ همان پاسخ با خودگزارشی
// customerState‌اش در تناقض است (مثلاً READY ولی بدون اقدام، یا painSolvable=NO ولی هنوز دارد
// می‌فروشد). نگاه کن به callFullAgentTurn، درست بعد از اولین finalCall
const CTA_CORRECTIVE_INSTRUCTION = `توجه فوری — تناقض در پاسخ قبلی‌ات: خودت گزارش دادی مشتری در
مرحله‌ی READY (آماده‌ی اقدام) است، ولی در همان پاسخ نه capture_lead را صدا زدی و نه شماره تماس
خواستی. این بار دقیقاً طبق بخش «مسیر تبدیل (CTA)» بالا عمل کن — اگر ابزار capture_lead در اختیارت است
همین الان صدایش بزن (کارت ثبت‌نام خودکار نمایش داده می‌شود)، وگرنه صریح و مؤدبانه شماره تماس بخواه؛ دیگر
فقط توضیح یا سؤال عمومی دیگری نده.`;

const PAIN_NOT_SOLVABLE_CORRECTIVE_INSTRUCTION = `توجه فوری — تناقض در پاسخ قبلی‌ات: خودت گزارش
دادی دردی که مشتری دارد را این فروشگاه نمی‌تواند حل کند (painSolvable=NO)، ولی هم‌زمان داشتی
می‌فروختی/پرزنت می‌کردی یا آماده‌ی بستن معامله اعلام کردی. این بار این تناقض را اصلاح کن: صادقانه و
مؤدبانه بگو این دقیقاً کاری نیست که این فروشگاه انجام می‌دهد — هیچ فشار فروش یا CTA دیگری نده.`;

// docs/PRD-sales-agent-tool-calling-architecture.md بخش ۳.۳ — یک محصول کمینه برای facts/ابزارهای
// FULL_AGENT؛ همون شکلی که seenProducts/uiBlock derivation نیاز دارند
type CompactProduct = {
  id: string;
  name: string;
  basePrice: number;
  stock: number;
  images: string[];
  description?: string | null;
  // docs/PRD-product-video.md بخش ۴
  videos: ProductVideoItem[];
  // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۸.۱ — فقط برای محصولات
  // WEIGHT_BASED_FORMULA پر می‌شود، تا PRODUCT_CARD بتواند وزن/عیار/اجرت را نشان بدهد
  weightGrams?: number | null;
  purityKarat?: number | null;
  isWeightBasedPricing?: boolean;
  goldPricingSummary?: string | null;
};

// docs/PRD-sales-agent-sales-state-machine.md §۱۵.۲ — از callFullAgentTurn به سطح ماژول آمد تا
// callSalesTurn هم همین schema را استفاده کند
// برای لاگ ادمین؛ خوداظهاری خودِ مدل، نه چیزی که سرور بتواند مستقل از متن تشخیص دهد
const persuasionShape = {
  persuasionTechniquesUsed: z
    .array(
      z.enum([
        'COMMITMENT_CONSISTENCY',
        'SOCIAL_PROOF',
        'AUTHORITY',
        'LIKING',
        'RECIPROCITY',
        'SCARCITY',
      ]),
    )
    .describe(
      'کدام‌یک از ۶ اصل متقاعدسازی را واقعاً در همین متن استفاده کردی — اگر هیچ‌کدام، خالی بگذار',
    ),
  usedGeneralKnowledge: z
    .boolean()
    .describe(
      'آیا در همین متن از دانش عمومی خودت (نه facts فروشگاه) درباره‌ی محبوبیت/شناخته‌شده‌بودن یک محصول استفاده کردی',
    ),
};

// docs/PRD-sales-agent-persuasion-principles.md بخش ۳.۲/۳.۳/۳.۴ — ثابت در کد (نه تنظیم پنل)،
// همون عادت این پروژه برای آستانه‌ها
const AUTHORITY_MIN_ORDER_COUNT = 5;
const LOW_STOCK_THRESHOLD = 5;
const URGENT_DISCOUNT_WINDOW_HOURS = 72;

// همون سند، بخش ۳/۳.۵ — فقط وقتی یک محصول واقعاً نشانه‌ی «[متقاعدسازی: مجاز]» دارد (یعنی
// persuasionTechniquesEnabled هم‌زمان روی فروشگاه و خودِ محصول روشن است) این تکنیک‌ها به‌کار
// می‌روند؛ برای بقیه‌ی محصولات این بخش کلاً نادیده گرفته می‌شود
const PERSUASION_INSTRUCTION = `اگر جلوی یک محصول در واقعیت‌ها نشانه‌ی «[متقاعدسازی: مجاز]» آمده،
می‌توانی طبیعی و کوتاه (نه فشار فروش) از تکنیک‌های متقاعدسازی اخلاقی زیر استفاده کنی — همیشه فقط با
سیگنال‌های واقعی که همان‌جا آمده، هرگز با عدد/ادعای ساختگی؛ برای محصولاتی که این نشانه را ندارند
اصلاً از این تکنیک‌ها استفاده نکن، فقط واقعیت خام را بگو:
۱. تعهد و ثبات: قبل از پیشنهاد، هدف خودِ مشتری را در یک جمله‌ی کوتاه echo کن، بعد پیشنهادت را
   دقیقاً به همان هدف وصل کن.
۲. اثبات اجتماعی: اگر نظر خریدار واقعی زیر محصول آمده، طبیعی به آن اشاره کن — اگر هم‌زمان خودِ
   محصول یک چیز عمومی/شناخته‌شده هم هست (طبق بند دانش عمومی پایین)، وقتی مشتری صریح نظر/رضایت
   می‌پرسد می‌توانی این دو را در یک جمله‌ی کوتاه ترکیب کنی: اول یک اشاره‌ی خیلی کوتاه به جایگاه/
   محبوبیت عمومی آن موضوع در دنیا، بلافاصله بعدش نظر واقعی خریدارهای همین فروشگاه — نه این‌که
   یکی را به‌جای دیگری بگویی.
۳. اقتدار: اگر «تعداد سفارش واقعی» زیر محصول آمده، می‌توانی به آن اشاره کنی.
۴. علاقه: لحن گرم و همدلانه داشته باش (طبق لحن بالا).
۵. تقابل: اگر واقعاً یک چیز اضافه/رایگان واقعی به مشتری می‌دهی (مثل یک نکته‌ی کاربردی رایگان
   مرتبط با نیازش، یک راهنمای کوچک، یا ارسال رایگان/امتیاز واقعی فروشگاه)، طبیعی اشاره کن که این
   یک لطف اضافه از طرف فروشگاه است — هرگز ادعای رایگان‌بودن/هدیه‌ی ساختگی نساز؛ اگر چیز واقعی‌ای
   برای دادن نداری، اصلاً از این اصل استفاده نکن.
۶. کمیابی: فقط اگر «موجودی محدود» (هرگز عدد دقیق) یا یک کد تخفیف واقعی با مهلت نزدیک زیر آمده،
   به آن اشاره کن — هرگز فوریت ساختگی نساز.
علاوه‌بر این شش‌تا: اگر خودِ محصول یک چیز عمومی و واقعاً شناخته‌شده در دنیاست (مثلاً یک فریم‌ورک/
تکنولوژی/برند معروف، نه یک محصول اختصاصی این فروشگاه)، فقط در همین حالت اجازه داری یک جمله‌ی کوتاه
از دانش عمومی خودت درباره‌ی خودِ آن موضوع (نه درباره‌ی این دوره/محصول مشخص فروشگاه) اضافه کنی —
مثلاً میزان محبوبیت/تقاضای بازار کار. اگر مطمئن نیستی این موضوع واقعاً به‌اندازه‌ی کافی شناخته‌شده
است، این کار را نکن. هیچ‌وقت بیشتر از یکی-دوتا از این تکنیک‌ها را هم‌زمان در یک پاسخ فشار نده.
در respond_to_customer، هرکدام از ۶ اصل بالا را که واقعاً در همین متن استفاده کردی در
persuasionTechniquesUsed بگذار (برای ثبت/گزارش داخلی فروشنده، نه چیزی که مشتری ببیند) و اگر از
دانش عمومی خودت (بند بالا) استفاده کردی usedGeneralKnowledge را true کن — اگر هیچ‌کدام را استفاده
نکردی، این‌ها را خالی/false بگذار، صادقانه.`;

// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۶ — فروشگاه دموی خودِ فروشنده
// (toggle فقط از پنل ادمین، هرگز از پنل فروشنده): این‌جا هیچ سفارش/پرداخت واقعی در کار نیست،
// هدف جمع‌آوری لید است. فیدبک کاربر ۱۴۰۵/۰۷/۲۰ — نسخه‌ی قبلی خیلی سوال‌محور بود و هرنوبت فقط
// یک سوال جدید می‌پرسید بدون اینکه واقعاً متقاعدسازی/پرزنت کند؛ و همیشه شماره تماس می‌خواست حتی
// وقتی فروشگاه لینک وبسایت واقعی (با ثبت‌نام + اعتبار هدیه) داشت. حالا: وقتی لینک هست، لینک
// اولویت دارد و شماره خواسته نمی‌شود؛ وقتی نیست، مسیر قبلی (گرفتن شماره) می‌ماند.
function buildLeadCaptureOnlyInstruction(): string {
  return `این فروشگاه حالت ثبت سفارش/پرداخت ندارد — هرگز ادعا نکن سفارشی ثبت شده یا قرار است
پرداختی انجام شود، و create_order اصلاً در اختیارت نیست.
سبک گفت‌وگو (مهم): هر نوبت حداکثر یک سؤال بپرس، نه بیشتر. به‌محض اینکه مشتری نوع کسب‌وکار یا
نیازش را گفت — حتی خیلی مختصر، مثل «کفش زنانه می‌فروشم» — دیگر صرفاً سؤال بعدی نپرس؛ به‌جایش:
۱) اول یکی-دو مشکل واقعی و ملموس که این نوع کسب‌وکار معمولاً با آن دست‌به‌گریبان است را خودت
   مطرح کن (مثلاً سؤال‌های تکراری در دایرکت، بی‌جواب‌ماندن پیام‌ها نیمه‌شب، ازدست‌رفتن مشتری به‌خاطر
   دیرجواب‌دادن) — طوری که مشتری حس کند مشکلش را می‌فهمی، نه اینکه فقط داری بازجویی می‌کنی.
۲) بعد ۲-۳ ویژگی مشخص و واقعی نیوو که دقیقاً همان مشکل را حل می‌کند را پررنگ بیان کن. چون پاسخ
   به‌صورت متن خام نمایش داده می‌شود (نه مارک‌داون)، هرگز از ستاره (**) برای بولدکردن استفاده نکن؛
   به‌جایش هر ویژگی را در یک خط جدا، با یک ایموجی کوتاه در ابتدا (مثلاً ✅)، کوتاه و محکم بنویس.
   تعریف کلی/تبلیغاتی مبهم (مثل «ما بهترینیم») ممنوع — فقط ویژگی مشخص.
۳) اگر مشتری علاقه نشان داد، صادقانه بگو با ثبت‌نام یک اعتبار هدیه‌ی رایگان برای شروع کار دریافت
   می‌کند — هرگز عدد/درصد دقیق اختراع نکن مگر در پروفایل فروشگاه یا باکس دانش زیر عدد واقعی‌اش
   آمده باشد.
مسیر تبدیل (CTA) — این بخش حیاتی است. توجه، این نکته را با دقت رعایت کن: اگر آخرین پیام مشتری
شامل یک سؤال مشخص است (قیمت/هزینه/شرایط/نحوه‌ی کارکرد و مشابه آن) — حتی اگر همزمان نشانه‌ی علاقه‌ی
خرید هم باشد (مثلاً «هزینه‌اش چقدره؟» هم سؤال است هم نشانه‌ی علاقه) — این یک «سؤال واقعی» است، نه
صرفاً «ابراز علاقه‌ی کلی». طبق «قوانین حیاتی» بالا باید همین الان (در همین نوبت) answer_faq را با
همان سؤال صدا بزنی و جوابش را بدهی؛ تنها بعد از آن مسیر زیر را ادامه بده. پیوت مستقیم به CTA
به‌جای جواب‌دادن، حتی وقتی مشتری آماده‌ی تبدیل به‌نظر می‌رسد، همیشه اشتباه است. «ابراز علاقه‌ی کلی»
(بدون سؤال مشخص) یعنی چیزهایی مثل «باشه خوبه»، «جالبه»، «آره می‌خوام»، و همچنین پاسخ تاییدی ساده به
پیشنهاد/سؤال قبلی خودِ تو — مثلاً وقتی خودت پرسیده‌ای «دوست دارید بگم چطور شروع می‌شه؟» یا مشابه آن
و مشتری فقط گفته «آره بگو»/«باشه بگو»/«آره». این نوع پاسخ هم یک سؤال مشخص جدید نیست، پس باید همان‌جا
یک قدم واقعی به CTA نزدیک‌تر شوی (نه این‌که دوباره فقط توضیح عمومی/ویژگی‌ها را تکرار کنی) — فقط در
این حالت‌ها می‌توانی مستقیم سراغ CTA بروی:
هدف نهایی ثبت‌نام رایگان فروشنده در نیوو است و ثبت‌نام داخل همین چت انجام می‌شود (کارت شماره + کد
پیامکی)، نه با تماس بعدی. وقتی مشتری علاقه‌ی کلی نشان داد (طبق تعریف بالا — نه یک سؤال مشخص بی‌جواب)
یا گفت «ثبت‌نام می‌کنم»، بلافاصله capture_lead را صدا بزن (interest را با یک جمله‌ی کوتاه از نیازش پر
کن)؛ کارت ثبت‌نام خودکار زیر پیام نمایش داده می‌شود و دیگر respond_to_customer لازم نیست. هرگز شماره‌ی
تماس را در متن نخواه و نگو «بهت زنگ می‌زنم»؛ فقط اگر مشتری خودش شماره‌اش را داوطلبانه نوشت، همان را در
phone بگذار.
این فروشگاه عمداً کاتالوگ محصول ندارد یا خیلی محدود است — اگر search_products چیزی پیدا نکرد یا
کاتالوگ خالی بود، هرگز نگو «محصولی نداریم» یا عذرخواهی نکن؛ این طبیعی و مورد انتظار است. به‌جایش
طبق معرفی فروشگاه (storeProfile) و باکس دانش درباره‌ی خودِ کسب‌وکار صحبت کن و گفت‌وگو را به سمت
همان هدف (جمع‌آوری لید) ببر.`;
}

// F13 — اکشن‌های دکمه‌ی سبد (بدون مدل)
export function isButtonCartAction(action: SalesAction): boolean {
  return (
    (action.type === 'ADD_TO_CART' && !!action.productId) ||
    action.type === 'SET_CART_QTY' ||
    action.type === 'REMOVE_CART_ITEM'
  );
}

@Injectable()
export class ConversationEngineService {
  private readonly logger = new Logger(ConversationEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
    private readonly storeKb: StoreKbService,
    private readonly cardSelector: CardSelectorService,
    private readonly creditService: CreditService,
    private readonly abuseGuard: AbuseGuardService,
    private readonly storage: StorageService,
    private readonly sellerBotApi: SellerBotApiClientService,
    private readonly comments: CommentsService,
    private readonly marketPrices: MarketPricesService,
    @InjectQueue('sales-agent-voice')
    private readonly voiceQueue: Queue<SalesAgentVoiceJobData>,
    private readonly lock: ConversationLockService,
    private readonly creditAlerts: CreditAlertService,
    private readonly orderState: OrderStateService,
    private readonly orderNotifications: OrderNotificationService,
    private readonly receiptChecks: ReceiptCheckService,
    private readonly notifications: NotificationService,
    private readonly productEvents: ProductEventService,
    private readonly productFinder: ProductFinderService,
  ) {}

  // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲.۳ — نقطه‌ی مرکزی حل
  // قیمت طلا برای هر مسیری که محصول از DB می‌خواند (جست‌وجو، سبد، تک‌محصول، مقایسه، ابزارهای
  // FULL_AGENT). no-op کامل برای محصولات FIXED (اکثریت قریب‌به‌اتفاق) — فقط اگر حداقل یک
  // محصول WEIGHT_BASED_FORMULA باشد یک کوئری اضافه (تنظیمات اجرت/سود فروشگاه) و یک خواندن
  // کش Redis (نرخ طلا) انجام می‌شود. basePrice/priceOverride را in-place overwrite می‌کند
  // تا هر جای فراخوان‌کننده که از قبل `.basePrice`/`variant.priceOverride` می‌خواند بدون
  // تغییر دیگری درست کار کند.
  private async resolveProductPrices<
    T extends ProductLike & { variants?: ProductVariantRow[] },
  >(storeId: string, products: T[]): Promise<void> {
    // SP-3 — همه‌ی مسیرهای بارگذاری محصول از این نقطه رد می‌شوند؛ محصول «همیشه موجود» همین‌جا
    // برای چک‌های عددی (سبد، کارت، کاندیدهای واریانت) موجودی نامحدود می‌گیرد
    for (const p of products) applyUntrackedStock(p);
    const goldProducts = products.filter(
      (p) => p.pricingModel === 'WEIGHT_BASED_FORMULA',
    );
    if (goldProducts.length === 0) return;

    const [store, goldPrices] = await Promise.all([
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: {
          goldWageType: true,
          goldWageValue: true,
          goldProfitPercent: true,
          goldVatPercent: true,
        },
      }),
      this.marketPrices.getGoldPrices(),
    ]);
    if (!store) return;
    const goldItems = goldPrices.items;

    for (const product of goldProducts) {
      try {
        product.basePrice = computeDisplayPrice(
          {
            pricingModel: product.pricingModel!,
            basePrice: product.basePrice,
            weightGrams: product.weightGrams ?? null,
            purityKarat: product.purityKarat ?? null,
            goldWageType: product.goldWageType,
            goldWageValue: product.goldWageValue,
            goldProfitPercent: product.goldProfitPercent,
          },
          null,
          store,
          goldItems,
        );
        product.goldPricingSummary = describeGoldPricing(
          {
            weightGrams: product.weightGrams ?? null,
            purityKarat: product.purityKarat ?? null,
            goldWageType: product.goldWageType,
            goldWageValue: product.goldWageValue,
            goldProfitPercent: product.goldProfitPercent,
          },
          store,
        );
        for (const v of product.variants ?? []) {
          v.priceOverride = computeDisplayPrice(
            {
              pricingModel: product.pricingModel!,
              basePrice: product.basePrice,
              weightGrams: product.weightGrams ?? null,
              purityKarat: product.purityKarat ?? null,
              goldWageType: product.goldWageType,
              goldWageValue: product.goldWageValue,
              goldProfitPercent: product.goldProfitPercent,
            },
            {
              priceOverride: v.priceOverride,
              weightGrams: v.weightGrams ?? null,
              purityKarat: v.purityKarat ?? null,
            },
            store,
            goldItems,
          );
        }
      } catch (err) {
        // محصول طلا ولی تنظیمات فروشگاه ناقص/نرخ لحظه‌ای در دسترس نیست — basePrice همان
        // مقدار قدیمی/۰ ذخیره‌شده می‌ماند (مثل همیشه)؛ این حالت فقط لاگ می‌شود، نه کرش، چون
        // یک پیام چت زنده با خریدار واقعی هرگز نباید به‌خاطر این متوقف شود
        const reason =
          err instanceof GoldPricingNotConfiguredError ||
          err instanceof GoldPriceUnavailableError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        this.logger.warn(
          `gold price resolution failed for product ${product.id}: ${reason}`,
        );
      }
    }
  }

  private getContext(conversation: ConversationWithStore): ConversationContext {
    const raw =
      conversation.contextData as unknown as ConversationContext | null;
    return {
      cart: raw?.cart ?? [],
      lastShownProducts: raw?.lastShownProducts ?? [],
      appliedDiscount: raw?.appliedDiscount ?? null,
      anchoredProductId: raw?.anchoredProductId ?? null,
      anchorHesitationStreak: raw?.anchorHesitationStreak ?? 0,
      addressStep: raw?.addressStep,
      pendingAddress: raw?.pendingAddress ?? null,
      pendingVariantSelection: raw?.pendingVariantSelection ?? null,
      // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — اگر اینجا whitelist نشود،
      // بعد از persistTransition دوباره raw از DB خوانده می‌شود و این فیلد همیشه undefined
      // برمی‌گردد (هم‌الگوی pendingAddress بالا)
      pendingOrderAddressSnapshot: raw?.pendingOrderAddressSnapshot ?? null,
      customerState: raw?.customerState ?? null,
      // docs/PRD-sales-agent-sales-state-machine.md §۵ — بدون این whitelist هر persistTransition
      // (که contextData را از getContext می‌سازد) حافظه‌ی فروش را پاک می‌کرد
      sales: raw?.sales ?? null,
      // docs/DESIGN-structured-product-search-for-chat-agent.md §۶.۳ — بدون این whitelist هر
      // persistTransition آخرین جست‌وجوی ساختاریافته را پاک می‌کرد
      lastSearch: raw?.lastSearch ?? null,
    };
  }

  // docs/PRD-customer-comments-and-discounts.md بخش الف/۶ — چند نظر تاییدشده‌ی اخیر یک محصول،
  // برای نشان‌دادن به خریدار بعدی (showProduct/doBrowse) به شکل یک خط واقعیت اضافه
  private async commentsFactsSuffix(productId: string): Promise<string> {
    const approved = await this.comments.getApprovedForProduct(productId, 2);
    if (approved.length === 0) return '';
    return `\nنظر خریدارهای قبلی: ${approved.map((c) => `«${c.text}»`).join('، ')}`;
  }

  // docs/PRD-seller-growth-tools-and-marketplace-trust.md بخش ۵ مورد ۲ — «خریداران این را هم
  // خریدند»: شمارش هم‌رخدادی ساده روی Order.items سفارش‌های تاییدشده (نه ML). همون الگوی
  // $queryRaw's containment JSONB که برای countApprovedOrdersForProduct استفاده شده
  private async crossSellFactsSuffix(
    storeId: string,
    productId: string,
  ): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT item->>'name' AS name, COUNT(DISTINCT orders.id)::bigint AS count
      FROM orders, jsonb_array_elements(items) AS item
      WHERE orders."storeId" = ${storeId}
        AND orders.status IN ('APPROVED', 'SHIPPED', 'DELIVERED')
        AND (item->>'productId') != ${productId}
        AND orders.id IN (
          SELECT id FROM orders
          WHERE "storeId" = ${storeId}
            AND status IN ('APPROVED', 'SHIPPED', 'DELIVERED')
            AND items @> ${JSON.stringify([{ productId }])}::jsonb
        )
      GROUP BY item->>'productId', item->>'name'
      ORDER BY count DESC
      LIMIT 3
    `;
    if (rows.length === 0) return '';
    return `\nخریدارانی که این محصول را خریدند این‌ها را هم خریدند: ${rows.map((r) => r.name).join('، ')}`;
  }

  private cartTotal(cart: CartItem[]): number {
    return cart.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
  }

  // docs/PRD-seller-growth-tools-and-marketplace-trust.md بخش ۵ مورد ۵ — مجموع تعداد کل
  // اقلام سبد (نه تعداد یک محصول خاص)، برای شرط minQuantity کد تخفیف پلکانی
  private cartQuantity(cart: CartItem[]): number {
    return cart.reduce((sum, item) => sum + item.qty, 0);
  }

  // docs/PRD-sales-agent-persuasion-principles.md بخش ۳.۲ — تعداد سفارش واقعاً تاییدشده
  // (status=APPROVED) که این محصول را داشته‌اند؛ Order.items رابطه‌ی مستقیم به Product نیست
  // (آرایه‌ی JSON است)، پس کانتینمنت JSONB لازم است — همون الگوی $executeRaw که برای کسر
  // اتمیک کد تخفیف در doCreateOrder استفاده می‌شود
  private async countApprovedOrdersForProduct(
    storeId: string,
    productId: string,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM orders
      WHERE "storeId" = ${storeId}
        AND status IN ('APPROVED', 'SHIPPED', 'DELIVERED')
        AND items @> ${JSON.stringify([{ productId }])}::jsonb
    `;
    return Number(rows[0]?.count ?? 0);
  }

  // همون سند بخش ۳.۳ — فقط وقتی مهلت واقعی نزدیک است (نه هر کد تخفیف فعالی) تا حس فوریت
  // دروغین نسازیم؛ یک کد تخفیف با ۳۰ روز مهلت را «فرصت محدود» نامیدن گمراه‌کننده است
  private async findUrgentActiveDiscount(
    storeId: string,
  ): Promise<{ code: string; expiresAt: Date } | null> {
    const soon = new Date(
      Date.now() + URGENT_DISCOUNT_WINDOW_HOURS * 60 * 60 * 1000,
    );
    const discount = await this.prisma.storeDiscountCode.findFirst({
      where: {
        storeId,
        isActive: true,
        expiresAt: { not: null, gt: new Date(), lte: soon },
      },
      orderBy: { expiresAt: 'asc' },
    });
    if (!discount) return null;
    if (
      discount.maxRedemptions != null &&
      discount.redemptionCount >= discount.maxRedemptions
    ) {
      return null;
    }
    return { code: discount.code, expiresAt: discount.expiresAt! };
  }

  // docs/PRD-sales-agent-persuasion-principles.md بخش ۳/۶.۳ — نشانه‌ی «[متقاعدسازی: مجاز]» +
  // سیگنال‌های واقعی اضافه، فقط وقتی هم فروشگاه هم خودِ محصول persuasionTechniquesEnabled روشن
  // دارند. اگر خاموش باشد، رشته‌ی خالی برمی‌گردد — PERSUASION_INSTRUCTION به مدل می‌گوید فقط
  // برای محصولات نشان‌دار از این تکنیک‌ها استفاده کند. هم در facts کاتالوگ اولیه (buildProductFactsLine)
  // هم در خروجی ابزار get_product_details استفاده می‌شود
  private async buildPersuasionNote(
    storeId: string,
    product: {
      id: string;
      stock: number;
      optionTypes?: ProductOptionTypeWithValues[];
      variants?: ProductVariantRow[];
      persuasionTechniquesEnabled: boolean;
    },
    storePersuasionEnabled: boolean,
  ): Promise<string> {
    if (!storePersuasionEnabled || !product.persuasionTechniquesEnabled) {
      return '';
    }
    const signals: string[] = [];
    const comments = await this.commentsFactsSuffix(product.id);
    if (comments) signals.push(comments.replace(/^\n/, ''));
    const orderCount = await this.countApprovedOrdersForProduct(
      storeId,
      product.id,
    );
    if (orderCount >= AUTHORITY_MIN_ORDER_COUNT) {
      signals.push(
        `تاکنون ${orderCount} سفارش واقعی تاییدشده برای این محصول ثبت شده`,
      );
    }
    const stockNow = displayStock(product);
    if (stockNow > 0 && stockNow <= LOW_STOCK_THRESHOLD) {
      signals.push(
        'موجودی این محصول محدود است (فقط عبارت کلی بگو، هرگز عدد دقیق)',
      );
    }
    const signalsText = signals.length
      ? ` — سیگنال‌های واقعی: ${signals.join('؛ ')}`
      : '';
    return ` [متقاعدسازی: مجاز]${signalsText}`;
  }

  // ACE-10 — کاندید جواب قطعی (مشترک بین shadow و on). null = شرایط برقرار نیست → LLM
  private async fastAnswerCandidate(
    conversation: ConversationWithStore,
    customerMessage: string,
    ctx: { lastShownProducts?: Array<{ id: string }> | null; usedPitchLines?: string[] },
    catalog: Array<{ id: string; name: string }>,
    requireNamedProduct: boolean,
  ) {
    const sig = buildSignature(customerMessage, {
      catalog: catalog.map((p) => ({ id: p.id, name: p.name })),
      lastShownProductIds: (ctx.lastShownProducts ?? []).map((p) => p.id),
    });
    const mentionsProduct = sig.entities.some((e) => e.startsWith('prod:'));
    if (requireNamedProduct && !mentionsProduct) return null;
    if (
      !eligibleForFastAnswer({ intent: sig.intent, negated: sig.negated, wordCount: sig.norm.split(' ').length, scope: sig.scope }) ||
      isContextDependent({ text: customerMessage, currentState: conversation.currentState, mentionsProduct })
    ) {
      return null;
    }
    const productId = sig.scope.slice(2);
    const product = await this.prisma.product.findUnique({
      where: { id: productId, ...BUYER_VISIBLE },
      include: PRODUCT_VARIANT_INCLUDE,
    });
    if (!product || product.storeId !== conversation.storeId || product.pricingModel === 'WEIGHT_BASED_FORMULA') return null;
    await this.resolveProductPrices(conversation.storeId, [product]);
    const briefs = await this.loadUsableBriefs([product]);
    const pitch = briefs.get(product.id)?.brief.pitch ?? null;
    const prices = [product.basePrice, ...(product.variants ?? []).map((v) => v.priceOverride ?? product.basePrice)];
    const composed = composeFastAnswer({
      intent: sig.intent,
      productName: product.name,
      price: { min: Math.min(...prices), max: Math.max(...prices) },
      inStock: displayStock(product) > 0,
      pitch,
      seed: conversation.id,
      usedLines: ctx.usedPitchLines,
    });
    return composed ? { sig, product, composed, mentionsProduct } : null;
  }

  // ACE-7 — همان پیام (دابل‌تپ/ارسال دوباره) در پنجره‌ی کوتاه، بدون هیچ رویداد بین‌شان → همان جواب قبلی بدون LLM.
  // فقط وقتی جواب قبلی کارت محصول/بدون کارت بوده (جهش سبد/سفارش هرگز تکرار نمی‌شود).
  private async tryServeDuplicate(conversation: ConversationWithStore, text: string): Promise<EngineResult | null> {
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId: conversation.id, type: { in: ['CUSTOMER_MESSAGE', 'AGENT_REPLY'] } },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    const [cur, reply, prev] = events;
    if (events.length < 3 || cur.type !== 'CUSTOMER_MESSAGE' || reply.type !== 'AGENT_REPLY' || prev.type !== 'CUSTOMER_MESSAGE') return null;
    const pText = (prev.payload as { text?: string } | null)?.text;
    const rp = reply.payload as { text?: string; uiBlock?: UiBlock; quickReplies?: string[] } | null;
    if (!pText || !rp?.text || normalizeFa(pText) !== normalizeFa(text)) return null;
    const { dedupeWindowSec } = await aceParams();
    if (cur.createdAt.getTime() - prev.createdAt.getTime() > dedupeWindowSec * 1000) return null;
    const ui: UiBlock = rp.uiBlock && (rp.uiBlock.type === 'NONE' || rp.uiBlock.type === 'PRODUCT_CARD') ? rp.uiBlock : { type: 'NONE' };
    if (rp.uiBlock && ui.type === 'NONE' && rp.uiBlock.type !== 'NONE') return null;
    aceNote('dedupe', `همین پیام کمتر از ${dedupeWindowSec} ثانیه پیش هم آمده بود؛ جواب قبلی تکرار شد، بدون LLM`, 'dedupe');
    await this.logReply(conversation, rp.text, ui, undefined, {
      intent: 'FULL_AGENT', handler: 'dedupe', factsOrPrompt: 'dedupe', model: 'none',
      toolsCalled: [], initialCatalogProductIds: [], stepsUsed: 0, mutationHappened: false, progressHappened: false, isFallbackAttempt: false,
    } as never, rp.quickReplies);
    return { reply: rp.text, uiBlocks: [ui], state: conversation.currentState, quickReplies: rp.quickReplies };
  }

  // ACE-11 — hit: همان جواب قبلی (سؤال عیناً تکراری، بدون LLM)
  private async trySemanticHit(
    conversation: ConversationWithStore,
    text: string,
    ctx: { cart?: unknown[]; lastShownProducts?: Array<{ id: string }> },
    catalog: Array<{ id: string; name: string }>,
  ): Promise<EngineResult | null> {
    const sig = buildSignature(text, { catalog, lastShownProductIds: (ctx.lastShownProducts ?? []).map((p) => p.id) });
    const dependent = isContextDependent({ text, currentState: conversation.currentState, mentionsProduct: sig.entities.some((e) => e.startsWith('prod:')) });
    if (!eligibleToLookup({ sig, state: conversation.currentState, cartEmpty: (ctx.cart ?? []).length === 0, dependent })) return null;
    const e = await semanticLookup(conversation.storeId, sig);
    if (!e) return null;
    aceNote('semanticCache', `سؤال عیناً تکراری (${sig.intent}) در همین فروشگاه؛ جواب قبلی از کش، بدون LLM`, 'semantic_cache');
    const uiBlock: UiBlock = { type: 'NONE' };
    await this.logReply(conversation, e.text, uiBlock, undefined, {
      intent: 'FULL_AGENT', handler: 'semanticCache', factsOrPrompt: `semantic_cache:${sig.intent}`, model: 'none',
      toolsCalled: [], initialCatalogProductIds: [], stepsUsed: 0, mutationHappened: false, progressHappened: false, isFallbackAttempt: false,
    } as never, e.quickReplies);
    return { reply: e.text, uiBlocks: [uiBlock], state: conversation.currentState, quickReplies: e.quickReplies };
  }

  // ACE-11 — نوشتن بعد از نوبت LLM (دو بار دیده شود)؛ هرگز خطا نمی‌دهد
  private async maybeStoreSemantic(
    conversation: ConversationWithStore,
    text: string,
    reply: string,
    rt: AgentTurnRuntime,
    toolNames: string[],
    uiBlockType: string,
    quickReplies: string[],
    catalog: Array<{ id: string; name: string }>,
  ): Promise<void> {
    try {
      if (!(await aceOn('semanticCache'))) return;
      const sig = buildSignature(text, { catalog, lastShownProductIds: (rt.ctx.lastShownProducts ?? []).map((p) => p.id) });
      const dependent = isContextDependent({ text, currentState: conversation.currentState, mentionsProduct: sig.entities.some((e) => e.startsWith('prod:')) });
      if (!eligibleToStore({
        sig, state: conversation.currentState, cartEmpty: rt.ctx.cart.length === 0, toolsCalled: toolNames,
        mutationHappened: rt.mutationHappened, uiBlockType, dependent, replyText: reply,
      })) return;
      const r = await semanticMaybeStore(conversation.storeId, sig, reply, quickReplies);
      if (r === 'stored') aceNote('semanticCache', `جواب سؤال سیاستی (${sig.intent}) برای تکرار بعدی در کش ذخیره شد`, 'semantic_cache');
    } catch {
      /* fail-open */
    }
  }

  // ACE-10 (on) — جواب ترکیبی بدون LLM؛ هر شکی → null و مسیر عادی. سؤال دوم قیمت در همان گفتگو → LLM (چانه‌زنی)
  private async tryServeFastAnswer(conversation: ConversationWithStore, text: string): Promise<EngineResult | null> {
    try {
      const dedupeOn = await aceOn('dedupe');
      if (dedupeOn) {
        const dup = await this.tryServeDuplicate(conversation, text);
        if (dup) return dup;
      }
      const fastOn = await aceOn('fastAnswers');
      const semOn = await aceOn('semanticCache');
      if (!fastOn && !semOn) return null;
      const ctx = (conversation.contextData ?? {}) as {
        lastShownProducts?: Array<{ id: string; name: string }>;
        usedPitchLines?: string[];
        customerState?: unknown;
        cart?: unknown[];
      };
      const catalog = await this.prisma.product.findMany({
        where: { storeId: conversation.storeId, ...BUYER_VISIBLE },
        select: { id: true, name: true },
        take: 300,
      });
      if (semOn) {
        const hit = await this.trySemanticHit(conversation, text, ctx, catalog);
        if (hit) return hit;
      }
      if (!fastOn || (ctx.usedPitchLines ?? []).length > 0) return null;
      const c = await this.fastAnswerCandidate(conversation, text, ctx, catalog, true);
      if (!c) return null;
      const { product, composed, sig } = c;
      const inStock = displayStock(product) > 0;
      const uiBlock: UiBlock = {
        type: 'PRODUCT_CARD',
        products: [{
          id: product.id,
          name: product.name,
          basePrice: product.basePrice,
          stock: displayStock(product),
          images: product.images,
          videos: parseProductVideos(product.videos),
          weightGrams: product.weightGrams ?? null,
          purityKarat: product.purityKarat ?? null,
          isWeightBasedPricing: false,
          goldPricingSummary: null,
        }],
      };
      const quickReplies = inStock ? ['بذار تو سبد', 'عکس بیشتر'] : [];
      aceNote('fastAnswers', `جواب قطعی (${sig.intent}) بدون LLM: قیمت/موجودی زنده از DB + پیچ برگه‌ی محصول`, 'fast_answer');
      await this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: {
          contextData: {
            ...ctx,
            lastShownProducts: [{ id: product.id, name: product.name }],
            usedPitchLines: composed.usedLines,
          } as never,
        },
      });
      await this.logReply(conversation, composed.text, uiBlock, undefined, {
        intent: 'FULL_AGENT',
        handler: 'tryServeFastAnswer',
        factsOrPrompt: `fast_answer:${sig.intent}`,
        model: 'none',
        lastShownProducts: [{ id: product.id, name: product.name }],
        toolsCalled: [],
        initialCatalogProductIds: [],
        stepsUsed: 0,
        mutationHappened: false,
        progressHappened: false,
        isFallbackAttempt: false,
      } as never, quickReplies);
      return { reply: composed.text, uiBlocks: [uiBlock], state: conversation.currentState, quickReplies };
    } catch (err) {
      this.logger.warn(`fast answer failed, LLM path used: ${(err as Error).message}`);
      return null;
    }
  }

  // ACE-10 (shadow) — هرگز خطا نمی‌دهد و نوبت را کند نمی‌کند (void). قیمت از DB، پیچ از برگه‌ی ACE-16.
  private async recordFastAnswerShadow(
    conversation: ConversationWithStore,
    customerMessage: string,
    realText: string,
    rt: AgentTurnRuntime,
    catalog: Array<{ id: string; name: string }>,
  ): Promise<void> {
    if (!(await aceShadow('fastAnswers'))) return;
    const c = await this.fastAnswerCandidate(conversation, customerMessage, rt.ctx as never, catalog, false);
    if (!c) return;
    await pushShadow({
      layer: 'fastAnswers',
      intent: c.sig.intent,
      storeId: conversation.storeId,
      storeCategory: conversation.store.category,
      conversationId: conversation.id,
      customerMessage,
      realText,
      candidateText: c.composed.text,
      tags: [
        ...(hasVariantOptions(c.product) ? ['multi_variant'] : []),
        ...(c.mentionsProduct ? [] : ['anaphora']),
      ],
    });
  }

  // ACE-16 — برگه‌ی معتبر هر محصول (hash باید با متن فعلی بخواند)؛ هر خطا/نبود جدول → Map خالی = رفتار امروز
  private async loadUsableBriefs(
    products: Array<{
      id: string; name: string; description?: string | null; specs?: unknown;
      optionTypes?: Array<{ name: string; values: Array<{ value: string }> }>;
    }>,
  ): Promise<Map<string, BriefRow>> {
    const out = new Map<string, BriefRow>();
    const withDesc = products.filter((p) => (p.description?.length ?? 0) > 0);
    if (!withDesc.length) return out;
    try {
      const rows = await this.prisma.productBrief.findMany({
        where: { productId: { in: withDesc.map((p) => p.id) }, status: 'ok' },
      });
      for (const r of rows) {
        const p = withDesc.find((x) => x.id === r.productId);
        if (!p) continue;
        const hash = briefInputHash({
          name: p.name,
          description: p.description ?? null,
          specs: p.specs ?? null,
          options: (p.optionTypes ?? []).map((o) => ({ name: o.name, values: o.values.map((v) => v.value) })),
        });
        const row = { descHash: r.descHash, status: r.status, sections: r.sections, brief: r.brief } as unknown as BriefRow;
        if (isBriefUsable(row, hash, p.description?.length ?? 0)) out.set(p.id, row);
      }
    } catch {
      /* جدول نیست/خطا: متن کامل مثل امروز */
    }
    return out;
  }

  private async buildProductFactsLine(
    storeId: string,
    product: {
      id: string;
      name: string;
      basePrice: number;
      stock: number;
      description?: string | null;
      specs?: unknown;
      persuasionTechniquesEnabled: boolean;
      // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۸.۱ — فقط محصولات طلا پر دارند
      goldPricingSummary?: string | null;
    },
    storePersuasionEnabled: boolean,
    descriptionMaxChars = DESCRIPTION_FACTS_MAX_CHARS,
    // ACE-16 — فقط وقتی لایه‌ی productBrief روشن و برگه‌ی معتبر هست؛ جایگزین «توضیحات» بریده‌شده
    briefRow?: BriefRow,
  ): Promise<string> {
    const descPart = product.description
      ? briefRow
        ? ` — برگه‌ی محصول: ${renderBriefFacts(briefRow, normalizeDescription(product.description))}`
        : ` — توضیحات: ${truncateDescriptionForFacts(product.description, descriptionMaxChars)}`
      : '';
    const base = `${product.name} (شناسه: ${product.id}, ${product.basePrice} تومان)${displayStock(product) === 0 ? ' — فعلاً ناموجود' : ''}${product.goldPricingSummary ? ` — ${product.goldPricingSummary}` : ''}${descPart}${formatSpecsForFacts(parseProductSpecs(product.specs))}`;
    const note = await this.buildPersuasionNote(
      storeId,
      product,
      storePersuasionEnabled,
    );
    return `${base}${note}`;
  }

  // یک ردیف آماری به‌ازای هر فراخوانی واقعی مدل (چه موفق، چه شکست‌خورده) — بخش C پلن
  // فیدبک اول پایلوت (A/B مدل‌ها)
  private async logAiCall(
    conversation: ConversationWithStore,
    // docs/PRD-sales-agent-response-strategy-ab.md بخش ۲ — 'AGENT_CAPTION' جدا از 'CAPTION' است
    // تا توکن/هزینه/تاخیر Track B (agent) در مقایسه با Track A قابل تفکیک بماند؛ ستون DB همچنان
    // String خام است (AbModelMetric.kind)، پس migration لازم ندارد
    kind:
      | 'PARSE_INTENT'
      | 'CAPTION'
      | 'AGENT_CAPTION'
      | 'SATISFACTION_CLASSIFY'
      | 'PERCEPTION',
    success: boolean,
    latencyMs: number,
  ) {
    await this.prisma.abModelMetric.create({
      data: {
        conversationId: conversation.id,
        variant: conversation.abVariant ?? 'gpt-5.4-mini',
        kind,
        success,
        latencyMs,
      },
    });
  }

  private async callParseIntent(
    text: string,
    state: ConversationState,
    model: string,
    storeContextSummary?: string | null,
  ): Promise<{
    result: ParsedIntent;
    inputTokens: number;
    outputTokens: number;
  }> {
    setCallSite('parse_intent');
    const { object, usage } = await generateObject({
      maxRetries: LLM_MAX_RETRIES,
      model: this.aiProvider.buildClient(undefined, {
        supportsStructuredOutputs: true,
      })(model),
      // productQuery/productIndex/quantity عمداً .nullable() هستند نه .optional() — با
      // supportsStructuredOutputs=true، OpenAI حالت strict را روی این JSON schema اجرا می‌کند
      // که در آن *همه‌ی* کلیدها باید توی "required" باشند، حتی آن‌هایی که می‌توانند خالی
      // باشند؛ .optional() یعنی کلید از required حذف شود که در strict mode با 400 رد می‌شود
      // (دقیقاً همان الگوی مستندشده در nivo-cal.service.ts). قبل از این فیکس، هر فراخوانی
      // parseIntent (هم مدل اصلی هم فالبک) با همین خطا throw می‌کرد و بی‌صدا UNCLEAR
      // برمی‌گشت — یعنی موتور فروش هیچ پیامی را واقعاً طبقه‌بندی نمی‌کرد.
      // schema/prompt در intent-classification.schema.ts — تنها منبع واحد، sales-agent-qa.service.ts
      // (تست دقت intent) هم از همین‌جا می‌خواند تا دریفت بین این دو caller پیش نیاید
      schema: intentClassificationSchema,
      system: buildIntentClassificationPrompt(state, storeContextSummary),
      prompt: text,
    });
    return {
      result: object,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
  }

  // فقط NLU — مدل هرگز مستقیم DB/state تغییر نمی‌دهد، فقط intent+entity استخراج می‌کند
  // (طبق قرارداد تول پلن گام ۱). با fallback واقعی: اگر مدل assign‌شده (A/B) throw کند،
  // یک بار دیگر با مدل پیش‌فرض امن تلاش می‌شود، نه مستقیم UNCLEAR
  private async parseIntent(
    text: string,
    conversation: ConversationWithStore,
  ): Promise<ParsedIntent> {
    const primaryModel = resolveModel(conversation.abVariant);
    // docs/PRD-sales-agent-implicit-need-detection.md بخش ۴.۱ — جمله‌ی کوتاه و ارزان (بدون
    // کوئری اضافه، conversation.store از قبل لود است) فقط برای تشخیص خامِ storeRelevance؛
    // fit دقیق با کاتالوگ واقعی در doBrowse سنجیده می‌شود، نه اینجا
    const storeContextSummary = [
      conversation.store.category &&
        `این فروشگاه در حوزه‌ی «${conversation.store.category}» فعالیت می‌کند`,
      conversation.store.brandIntro,
    ]
      .filter(Boolean)
      .join('. ');
    const started = Date.now();
    try {
      const { result, inputTokens, outputTokens } = await this.callParseIntent(
        text,
        conversation.currentState,
        primaryModel,
        storeContextSummary,
      );
      await this.logAiCall(
        conversation,
        'PARSE_INTENT',
        true,
        Date.now() - started,
      );
      await this.logTextCreditUsage(
        conversation,
        primaryModel,
        inputTokens,
        outputTokens,
      );
      return result;
    } catch (err) {
      this.logger.error(
        `parseIntent failed (model=${primaryModel}, conversation=${conversation.id})`,
        err as Error,
      );
      await this.logAiCall(
        conversation,
        'PARSE_INTENT',
        false,
        Date.now() - started,
      );
      if (primaryModel === defaultModel()) return { intent: 'UNCLEAR' };
      const fallbackStarted = Date.now();
      try {
        const { result, inputTokens, outputTokens } =
          await this.callParseIntent(
            text,
            conversation.currentState,
            defaultModel(),
            storeContextSummary,
          );
        await this.logAiCall(
          conversation,
          'PARSE_INTENT',
          true,
          Date.now() - fallbackStarted,
        );
        await this.logTextCreditUsage(
          conversation,
          defaultModel(),
          inputTokens,
          outputTokens,
        );
        return result;
      } catch (fallbackErr) {
        this.logger.error(
          `parseIntent fallback failed (model=${defaultModel()}, conversation=${conversation.id})`,
          fallbackErr as Error,
        );
        await this.logAiCall(
          conversation,
          'PARSE_INTENT',
          false,
          Date.now() - fallbackStarted,
        );
        const chained = await this.tryModelFallbackChain(
          conversation,
          'PARSE_INTENT',
          'parseIntent',
          (model) =>
            this.callParseIntent(
              text,
              conversation.currentState,
              model,
              storeContextSummary,
            ),
        );
        return chained ?? { intent: 'UNCLEAR' };
      }
    }
  }

  // docs/PRD-seller-credit-billing.md — نقطه‌ی مشترک لاگ مصرف متن، از هر سه call site واقعی
  // (parseIntent/caption/tryAnswerFromProductDescriptions) صدا زده می‌شود
  private async logTextCreditUsage(
    conversation: ConversationWithStore,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    // 1.2(۳) — کسر اعتبار هیچ‌وقت نباید از فراخوان مدل throw شود: این تابع داخل try ی فراخوان
    // مدل صدا زده می‌شود و خطای کسر آنجا به «مدل بعدی fallback» تعبیر می‌شد (هزینه‌ی دوباره
    // برای یک پاسخ). خطا فقط لاگ می‌شود (Sentry)؛ مصرف از دست‌رفته قابل‌پیگیری است.
    try {
      await this.creditService.logTextUsage({
        storeId: conversation.storeId,
        customerId: conversation.customerId,
        conversationId: conversation.id,
        billingMode: conversation.billingMode,
        model,
        inputTokens,
        outputTokens,
      });
    } catch (err) {
      this.logger.error(
        `credit deduction failed (store=${conversation.storeId}, conversation=${conversation.id}, model=${model}, in=${inputTokens}, out=${outputTokens})`,
        err as Error,
      );
    }
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۲۱ — وقتی مدل A/B و بعد defaultModel() هم شکست خوردند، به‌جای تسلیم‌شدن
  // به مقدار degraded، DEFAULT_MODEL_FALLBACK_CHAIN را به‌ترتیب امتحان کن. هر تلاش دقیقاً مثل
  // تلاش‌های قبلی لاگ/بیل می‌شود (logAiCall/logTextCreditUsage)؛ روی اولین موفقیت برمی‌گردد، و
  // اگر همه شکست خوردند null برمی‌گرداند تا caller مقدار degraded مخصوص خودش را برگرداند.
  private async tryModelFallbackChain<T>(
    conversation: ConversationWithStore,
    kind:
      | 'PARSE_INTENT'
      | 'CAPTION'
      | 'AGENT_CAPTION'
      | 'SATISFACTION_CLASSIFY'
      | 'PERCEPTION',
    label: string,
    run: (
      model: string,
    ) => Promise<{ result: T; inputTokens: number; outputTokens: number }>,
  ): Promise<T | null> {
    // 2.1 — حداکثر LLM_FALLBACK_MAX_MODELS مدل (نه کل زنجیره‌ی ۷تایی)؛ هر مدل اضافه یعنی تا ۲۰ ثانیه
    // انتظار بیشتر و هزینه‌ی بیشتر
    for (const model of DEFAULT_MODEL_FALLBACK_CHAIN.slice(
      0,
      LLM_FALLBACK_MAX_MODELS,
    )) {
      const started = Date.now();
      try {
        const { result, inputTokens, outputTokens } = await run(model);
        await this.logAiCall(conversation, kind, true, Date.now() - started);
        await this.logTextCreditUsage(
          conversation,
          model,
          inputTokens,
          outputTokens,
        );
        return result;
      } catch (err) {
        this.logger.error(
          `${label} chain fallback failed (model=${model}, conversation=${conversation.id})`,
          err as Error,
        );
        await this.logAiCall(conversation, kind, false, Date.now() - started);
      }
    }
    return null;
  }

  private async callCaption(
    facts: string,
    model: string,
    category: string | null,
    // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — قبلاً این‌جا سوال واقعی مشتری اصلاً پاس داده نمی‌شد، پس
    // caption() همیشه یک معرفی کلی می‌ساخت، حتی وقتی مشتری سوال مشخصی (مثل «سرفصل‌هاش چیه؟»)
    // پرسیده بود که جوابش در facts/description بود
    customerQuestion?: string,
    // فیدبک زنده‌ی کاربر ۱۴۰۵/۰۷/۱۰ — وقتی caller (doBrowse/showProduct) خودش قبلاً یک
    // خوش‌آمدگویی ثابت (buildGreeting) جلوی همین متن چسبانده، بدون این پرچم مدل هم مستقل خودش
    // یک «سلام! خوش اومدی 😊» دیگر اول پاسخ می‌ساخت (لحن «دوستانه و محاوره‌ای» پایین طبیعتاً این
    // را القا می‌کند) و نتیجه دو تا سلام پشت‌سرهم در یک پیام بود
    skipGreeting = false,
    // docs/PRD-sales-agent-response-strategy-ab.md بخش ۱ (Track A، ردیف bridgeAndPitch) —
    // وقتی غیر-null است یعنی پشت درخواست مشتری یک هدف بزرگ‌تر implicit تشخیص داده شده که با
    // این فروشگاه مرتبط است و برای پیشنهاد آماده‌ایم؛ مدل باید اول آن هدف را تایید کند، بعد با
    // یک پل علّی کوتاه توضیح بدهد این محصول چطور به آن هدف کمک می‌کند، بعد محصول را معرفی کند —
    // نه این‌که مستقیم برود سراغ معرفی محصول (رفتار قبلی که مشتری حس می‌کرد «نیازش فهمیده نشد»)
    bridgeNeedSummary?: string | null,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const tone = toneForCategory(category);
    setCallSite('caption_browse');
    const { text, usage } = await generateText({
      maxRetries: LLM_MAX_RETRIES,
      model: this.aiProvider.buildClient()(model),
      system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. فقط و فقط از «واقعیت‌های»
داده‌شده یک پیام فارسی کوتاه (حداکثر ۲-۳ جمله)، دوستانه و محاوره‌ای بساز — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در واقعیت‌ها نیامده اضافه نکن، و پیشنهاد بعدی اختراع نکن. هر کد/شناسه‌ی حروفی-عددی
(مثل کد تخفیف) که در واقعیت‌ها آمده باید عیناً و حرف‌به‌حرف همان‌طور کپی شود — هیچ تبدیل رقم
فارسی⇄انگلیسی، تغییر حروف، یا بازنویسی روی آن مجاز نیست. هرگز تعداد دقیق موجودی
انبار را اعلام نکن (حتی اگر مشتری صریح بپرسد)، فقط «موجود است» یا «فعلاً ناموجود».
لحن نوشتار باید ${tone} باشد.${
        customerQuestion
          ? '\nمشتری زیر «سوال مشتری» یک سوال مشخص پرسیده — مستقیم و دقیق با استفاده از همین واقعیت‌ها جوابش را بده؛ اگر واقعیت‌ها جوابش را ندارند، صادقانه بگو که این اطلاعات را نداری.'
          : ''
      }${
        bridgeNeedSummary
          ? `\nهدف واقعی مشتری (نه اسم محصول): «${bridgeNeedSummary}». ابتدا در یک جمله‌ی کوتاه نشان بده این هدف را فهمیده‌ای، بعد با یک جمله‌ی کوتاه پل بزن که چرا این محصول به این هدف کمک می‌کند، و در آخر محصول را معرفی کن — نه برعکس.`
          : ''
      }${
        skipGreeting
          ? '\nیک پیام خوش‌آمد جداگانه همین الان قبل از این متن برای مشتری فرستاده شده — این پیام را هرگز با «سلام»/«خوش اومدی»/هر نوع احوال‌پرسی شروع نکن، مستقیم برو سراغ محتوا.'
          : ''
      }`,
      prompt: customerQuestion
        ? `سوال مشتری: ${customerQuestion}\n\nواقعیت‌ها:\n${facts}`
        : facts,
      temperature: 0.3,
    });
    return {
      // QA-17 — مبلغ‌های متن آزاد مدل با جداکننده‌ی هزارگان
      text: formatTomanAmountsInText(text.trim()),
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
  }

  // بازنویسی نتیجه‌ی واقعی تول به یک پیام فارسی کوتاه — مدل هرگز چیزی غیر از دیتای واقعی
  // پاس‌داده‌شده را حدس نمی‌زند (طبق اصل امنیتی PAYMENT_INSTRUCTIONS، سند اجرایی بخش ۵.۳).
  // همان fallback دومرحله‌ای parseIntent را دارد
  private async caption(
    facts: string,
    conversation: ConversationWithStore,
    customerQuestion?: string,
    skipGreeting = false,
    bridgeNeedSummary?: string | null,
  ): Promise<string> {
    const primaryModel = resolveModel(conversation.abVariant);
    const category = conversation.store.category;
    const started = Date.now();
    try {
      const { text, inputTokens, outputTokens } = await this.callCaption(
        facts,
        primaryModel,
        category,
        customerQuestion,
        skipGreeting,
        bridgeNeedSummary,
      );
      await this.logAiCall(conversation, 'CAPTION', true, Date.now() - started);
      await this.logTextCreditUsage(
        conversation,
        primaryModel,
        inputTokens,
        outputTokens,
      );
      return text;
    } catch (err) {
      this.logger.error(
        `caption failed (model=${primaryModel}, conversation=${conversation.id})`,
        err as Error,
      );
      await this.logAiCall(
        conversation,
        'CAPTION',
        false,
        Date.now() - started,
      );
      if (primaryModel === defaultModel()) return facts;
      const fallbackStarted = Date.now();
      try {
        const { text, inputTokens, outputTokens } = await this.callCaption(
          facts,
          defaultModel(),
          category,
          customerQuestion,
          skipGreeting,
          bridgeNeedSummary,
        );
        await this.logAiCall(
          conversation,
          'CAPTION',
          true,
          Date.now() - fallbackStarted,
        );
        await this.logTextCreditUsage(
          conversation,
          defaultModel(),
          inputTokens,
          outputTokens,
        );
        return text;
      } catch (fallbackErr) {
        this.logger.error(
          `caption fallback failed (model=${defaultModel()}, conversation=${conversation.id})`,
          fallbackErr as Error,
        );
        await this.logAiCall(
          conversation,
          'CAPTION',
          false,
          Date.now() - fallbackStarted,
        );
        const chained = await this.tryModelFallbackChain(
          conversation,
          'CAPTION',
          'caption',
          (model) =>
            this.callCaption(
              facts,
              model,
              category,
              customerQuestion,
              skipGreeting,
              bridgeNeedSummary,
            ).then(({ text, inputTokens, outputTokens }) => ({
              result: text,
              inputTokens,
              outputTokens,
            })),
        );
        return chained ?? facts;
      }
    }
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — doBrowse() قبلاً کارت همه‌ی محصولات کاندید را مستقل از متن پاسخ
  // attach می‌کرد (مثلاً مشتری می‌پرسید «برای فرانت‌اند کدوم بهتره؟»، جواب درست React بود ولی
  // کارت دوره‌ی پایتون هم زیرش می‌ماند). این متد مخصوص همون حالت چندمحصولیه: دقیقاً همون سیستم
  // پرامپت callCaption را دارد، فقط به‌جای generateText از generateObject استفاده می‌کند تا
  // کنار متن پاسخ، شناسه‌ی محصولات واقعاً مرتبط را هم برگرداند — یک فراخوان AI، نه دوتا.
  private async callCaptionWithRelevance(
    facts: string,
    model: string,
    category: string | null,
    candidateProductIds: string[],
    customerQuestion?: string,
    // همون دلیل callCaption بالا — doBrowse وقتی isFirstReply است خودش buildGreeting را جلوی
    // همین متن می‌چسباند
    skipGreeting = false,
    // همون دلیل bridgeNeedSummary در callCaption بالا — طبق جدول تصمیم Track A
    bridgeNeedSummary?: string | null,
  ): Promise<{
    text: string;
    relevantProductIds: string[];
    inputTokens: number;
    outputTokens: number;
  }> {
    const tone = toneForCategory(category);
    setCallSite('caption_structured');
    const { object, usage } = await generateObject({
      maxRetries: LLM_MAX_RETRIES,
      model: this.aiProvider.buildClient(undefined, {
        supportsStructuredOutputs: true,
      })(model),
      schema: z.object({
        text: z.string(),
        relevantProductIds: z.array(z.string()),
      }),
      system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. فقط و فقط از «واقعیت‌های»
داده‌شده یک پیام فارسی کوتاه (حداکثر ۲-۳ جمله)، دوستانه و محاوره‌ای بساز — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در واقعیت‌ها نیامده اضافه نکن، و پیشنهاد بعدی اختراع نکن. هر کد/شناسه‌ی حروفی-عددی
(مثل کد تخفیف) که در واقعیت‌ها آمده باید عیناً و حرف‌به‌حرف همان‌طور کپی شود — هیچ تبدیل رقم
فارسی⇄انگلیسی، تغییر حروف، یا بازنویسی روی آن مجاز نیست. هرگز تعداد دقیق موجودی
انبار را اعلام نکن (حتی اگر مشتری صریح بپرسد)، فقط «موجود است» یا «فعلاً ناموجود».
لحن نوشتار باید ${tone} باشد.${
        customerQuestion
          ? '\nمشتری زیر «سوال مشتری» یک سوال مشخص پرسیده — مستقیم و دقیق با استفاده از همین واقعیت‌ها جوابش را بده؛ اگر واقعیت‌ها جوابش را ندارند، صادقانه بگو که این اطلاعات را نداری.'
          : ''
      }${
        bridgeNeedSummary
          ? `\nهدف واقعی مشتری (نه اسم محصول): «${bridgeNeedSummary}». ابتدا در یک جمله‌ی کوتاه نشان بده این هدف را فهمیده‌ای، بعد با یک جمله‌ی کوتاه پل بزن که چرا محصول(های) پیشنهادی به این هدف کمک می‌کنند، و در آخر محصول را معرفی کن — نه برعکس.`
          : ''
      }
علاوه‌بر متن پاسخ، باید تصمیم بگیری در relevantProductIds چند و کدام محصول برگردانی — دقیقاً
همین ترتیب را رعایت کن:
۱. اگر مشتری نیاز/سؤال مشخصی دارد و یک محصول به‌تنهایی جوابش است (مثلاً «برای فرانت‌اند کدوم
بهتره؟» با یک برنده‌ی مشخص)، فقط همان یک شناسه را برگردان — تعداد کمتر همیشه بهتر از توضیح
پراکنده است.
۲. وگرنه اگر مشتری معرفی کلی/چندتایی می‌خواهد، حداکثر ۳ تای مرتبط‌ترین کاندید را برگردان —
هرگز کورکورانه همه‌ی کاندیدها را برنگردان و هرگز بیشتر از ۳ تا.
شناسه‌های کاندید: ${candidateProductIds.join(', ')}${
        skipGreeting
          ? '\nیک پیام خوش‌آمد جداگانه همین الان قبل از این متن برای مشتری فرستاده شده — فیلد text را هرگز با «سلام»/«خوش اومدی»/هر نوع احوال‌پرسی شروع نکن، مستقیم برو سراغ محتوا.'
          : ''
      }`,
      prompt: customerQuestion
        ? `سوال مشتری: ${customerQuestion}\n\nواقعیت‌ها:\n${facts}`
        : facts,
      temperature: 0.3,
    });
    return {
      text: object.text.trim(),
      relevantProductIds: object.relevantProductIds,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
  }

  // همون fallback دومرحله‌ای caption()، فقط با خروجی relevantProductIds اضافه؛ اگر هر دو
  // تلاش شکست خورد یا مدل خروجی غیرمنتظره داد، fallback امن «همه‌ی کاندیدها مرتبط‌اند» است —
  // نه اینکه هیچ محصولی نشان داده نشود
  private async captionWithRelevance(
    facts: string,
    conversation: ConversationWithStore,
    candidateProductIds: string[],
    customerQuestion?: string,
    skipGreeting = false,
    bridgeNeedSummary?: string | null,
  ): Promise<{ text: string; relevantProductIds: string[] }> {
    const primaryModel = resolveModel(conversation.abVariant);
    const category = conversation.store.category;
    const started = Date.now();
    try {
      const { text, relevantProductIds, inputTokens, outputTokens } =
        await this.callCaptionWithRelevance(
          facts,
          primaryModel,
          category,
          candidateProductIds,
          customerQuestion,
          skipGreeting,
          bridgeNeedSummary,
        );
      await this.logAiCall(conversation, 'CAPTION', true, Date.now() - started);
      await this.logTextCreditUsage(
        conversation,
        primaryModel,
        inputTokens,
        outputTokens,
      );
      return {
        text,
        relevantProductIds:
          relevantProductIds.length > 0
            ? relevantProductIds
            : candidateProductIds,
      };
    } catch (err) {
      this.logger.error(
        `captionWithRelevance failed (model=${primaryModel}, conversation=${conversation.id})`,
        err as Error,
      );
      await this.logAiCall(
        conversation,
        'CAPTION',
        false,
        Date.now() - started,
      );
      if (primaryModel === defaultModel()) {
        return { text: facts, relevantProductIds: candidateProductIds };
      }
      const fallbackStarted = Date.now();
      try {
        const { text, relevantProductIds, inputTokens, outputTokens } =
          await this.callCaptionWithRelevance(
            facts,
            defaultModel(),
            category,
            candidateProductIds,
            customerQuestion,
            skipGreeting,
            bridgeNeedSummary,
          );
        await this.logAiCall(
          conversation,
          'CAPTION',
          true,
          Date.now() - fallbackStarted,
        );
        await this.logTextCreditUsage(
          conversation,
          defaultModel(),
          inputTokens,
          outputTokens,
        );
        return {
          text,
          relevantProductIds:
            relevantProductIds.length > 0
              ? relevantProductIds
              : candidateProductIds,
        };
      } catch (fallbackErr) {
        this.logger.error(
          `captionWithRelevance fallback failed (model=${defaultModel()}, conversation=${conversation.id})`,
          fallbackErr as Error,
        );
        await this.logAiCall(
          conversation,
          'CAPTION',
          false,
          Date.now() - fallbackStarted,
        );
        const chained = await this.tryModelFallbackChain(
          conversation,
          'CAPTION',
          'captionWithRelevance',
          (model) =>
            this.callCaptionWithRelevance(
              facts,
              model,
              category,
              candidateProductIds,
              customerQuestion,
              skipGreeting,
              bridgeNeedSummary,
            ).then(
              ({ text, relevantProductIds, inputTokens, outputTokens }) => ({
                result: {
                  text,
                  relevantProductIds:
                    relevantProductIds.length > 0
                      ? relevantProductIds
                      : candidateProductIds,
                },
                inputTokens,
                outputTokens,
              }),
            ),
        );
        return (
          chained ?? { text: facts, relevantProductIds: candidateProductIds }
        );
      }
    }
  }

  // docs/PRD-sales-agent-response-strategy-ab.md بخش ۱ (Track A، ردیف askClarifyingQuestion)
  // — وقتی pitchReadiness=NEEDS_CLARIFICATION است، به‌جای حدس‌زدن و نشان‌دادن یک محصول (رفتار
  // قدیمی که در eval واقعی باعث شد مشتری با هدف مبهم مستقیم یک محصول نامرتبط ببیند)، یک سوال
  // کوتاه و مشخص می‌پرسیم تا هدف دقیق‌تر شود. فقط بر اساس «واقعیت‌ها»ی فروشگاه سوال می‌سازد —
  // هرگز در این مرحله محصولی معرفی/نام‌برده نمی‌شود
  private async callAskClarifyingQuestion(
    facts: string,
    model: string,
    category: string | null,
    needSummary: string,
    skipGreeting = false,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const tone = toneForCategory(category);
    setCallSite('caption_text');
    const { text, usage } = await generateText({
      maxRetries: LLM_MAX_RETRIES,
      model: this.aiProvider.buildClient()(model),
      system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. مشتری یک هدف کلی دارد
(«${needSummary}») ولی هنوز اطلاعات کافی برای پیشنهاد دقیق محصول نداری. فقط بر اساس «واقعیت‌های»
زیر (محصولات واقعی فروشگاه)، یک پیام فارسی کوتاه (حداکثر ۱-۲ جمله) و ${tone} بساز که دقیقاً یک
سوال مشخص بپرسد تا بفهمی کدام محصول را پیشنهاد بدهی. هیچ محصولی را در این مرحله نام نبر یا پیشنهاد
نکن، و هیچ عدد/اسم تازه‌ای که در واقعیت‌ها نیامده اختراع نکن.${
        skipGreeting
          ? '\nیک پیام خوش‌آمد جداگانه همین الان قبل از این متن برای مشتری فرستاده شده — این پیام را هرگز با «سلام»/«خوش اومدی»/هر نوع احوال‌پرسی شروع نکن، مستقیم برو سراغ سوال.'
          : ''
      }`,
      prompt: facts,
      temperature: 0.3,
    });
    return {
      text: text.trim(),
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
  }

  // همون fallback دومرحله‌ای caption() — اگر هر دو تلاش شکست خورد، fallback یک متن ثابت است
  // (fa.salesAgent.clarifyNeedFallback)، نه facts خام (که برخلاف caption، برای این مورد متن
  // قابل‌نمایش به مشتری نیست)
  private async askClarifyingQuestion(
    facts: string,
    conversation: ConversationWithStore,
    needSummary: string,
    skipGreeting = false,
  ): Promise<string> {
    const primaryModel = resolveModel(conversation.abVariant);
    const category = conversation.store.category;
    const started = Date.now();
    try {
      const { text, inputTokens, outputTokens } =
        await this.callAskClarifyingQuestion(
          facts,
          primaryModel,
          category,
          needSummary,
          skipGreeting,
        );
      await this.logAiCall(conversation, 'CAPTION', true, Date.now() - started);
      await this.logTextCreditUsage(
        conversation,
        primaryModel,
        inputTokens,
        outputTokens,
      );
      return text;
    } catch (err) {
      this.logger.error(
        `askClarifyingQuestion failed (model=${primaryModel}, conversation=${conversation.id})`,
        err as Error,
      );
      await this.logAiCall(
        conversation,
        'CAPTION',
        false,
        Date.now() - started,
      );
      if (primaryModel === defaultModel()) {
        return fa.salesAgent.clarifyNeedFallback;
      }
      const fallbackStarted = Date.now();
      try {
        const { text, inputTokens, outputTokens } =
          await this.callAskClarifyingQuestion(
            facts,
            defaultModel(),
            category,
            needSummary,
            skipGreeting,
          );
        await this.logAiCall(
          conversation,
          'CAPTION',
          true,
          Date.now() - fallbackStarted,
        );
        await this.logTextCreditUsage(
          conversation,
          defaultModel(),
          inputTokens,
          outputTokens,
        );
        return text;
      } catch (fallbackErr) {
        this.logger.error(
          `askClarifyingQuestion fallback failed (model=${defaultModel()}, conversation=${conversation.id})`,
          fallbackErr as Error,
        );
        await this.logAiCall(
          conversation,
          'CAPTION',
          false,
          Date.now() - fallbackStarted,
        );
        const chained = await this.tryModelFallbackChain(
          conversation,
          'CAPTION',
          'askClarifyingQuestion',
          (model) =>
            this.callAskClarifyingQuestion(
              facts,
              model,
              category,
              needSummary,
              skipGreeting,
            ).then(({ text, inputTokens, outputTokens }) => ({
              result: text,
              inputTokens,
              outputTokens,
            })),
        );
        return chained ?? fa.salesAgent.clarifyNeedFallback;
      }
    }
  }

  private async searchProducts(storeId: string, query?: string | null) {
    // docs/PRD-telegram-bot-channel.md بخش ۹.۳ — کد محصول (روی محتوای تبلیغاتی) قبل از
    // جستجوی نام امتحان می‌شود؛ اگر دقیقاً مچ شد، فقط همان یکی برگردانده می‌شود
    if (query) {
      const exact = await this.prisma.product.findFirst({
        where: { storeId, ...BUYER_VISIBLE, code: { equals: query, mode: 'insensitive' } },
        include: PRODUCT_VARIANT_INCLUDE,
      });
      if (exact) {
        await this.resolveProductPrices(storeId, [exact]);
        return [exact];
      }
    }
    const results = await this.prisma.product.findMany({
      where: { ...BUYER_VISIBLE,
        storeId,
        ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: PRODUCT_VARIANT_INCLUDE,
    });
    await this.resolveProductPrices(storeId, results);
    return results;
  }

  // docs/PRD-sales-agent-consultative-recommendation.md بخش ۳.۲ — فقط برای ابزار search_products
  // در FULL_AGENT؛ عمداً متد مشترک searchProducts بالا را دست نمی‌زند چون مسیرهای قدیمی
  // RULE_BASED/SIMPLE_AGENT (هنوز برای مکالمه‌های از قبل روی آن استراتژی زنده‌اند) هم از آن
  // استفاده می‌کنند و نباید رفتارشان بی‌سروصدا عوض شود
  private async searchProductsForConsultation(storeId: string, query: string) {
    const exact = await this.prisma.product.findFirst({
      where: { storeId, ...BUYER_VISIBLE, code: { equals: query, mode: 'insensitive' } },
      include: PRODUCT_VARIANT_INCLUDE,
    });
    if (exact) {
      await this.resolveProductPrices(storeId, [exact]);
      return [exact];
    }

    const literalMatches = await this.prisma.product.findMany({
      where: { ...BUYER_VISIBLE,
        storeId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: PRODUCT_VARIANT_INCLUDE,
    });
    if (literalMatches.length > 0) {
      await this.resolveProductPrices(storeId, literalMatches);
      return literalMatches;
    }

    // هیچ تطابق تحت‌اللفظی‌ای نبود — احتمالاً پیام نیازمحور است، نه اسم محصول (مثل «پیجم رشد
    // نمی‌کنه»). کل کاتالوگ را تا سقف ثابت برگردان تا خودِ مدل با توضیحات واقعی هر محصول
    // استدلال کند؛ بالاتر از این سقف خارج از محدوده‌ی این طراحی است (نیاز به retrieval واقعی دارد)
    //
    // docs/PRD-full-agent-engineering-review.md بخش ۴/۹ — این سقف دقیقاً روی لبه‌ی پایینی همان
    // آستانه‌ای نشسته که PRD-sales-agent-implicit-need-detection.md گفته بود باید بازبینی شود؛
    // بدون این لاگ هیچ راهی برای فهمیدن این‌که یک فروشگاه واقعی از این سقف رد شده نبود.
    const totalActive = await this.prisma.product.count({
      where: { storeId, ...BUYER_VISIBLE },
    });
    if (totalActive > CONSULTATION_FULL_CATALOG_FALLBACK_CAP) {
      this.logger.warn(
        `consultation fallback cap hit: store ${storeId} has ${totalActive} ` +
          `products (cap ${CONSULTATION_FULL_CATALOG_FALLBACK_CAP}), query="${query}"`,
      );
    }
    const fallback = await this.prisma.product.findMany({
      where: { storeId, ...BUYER_VISIBLE },
      orderBy: { createdAt: 'desc' },
      take: CONSULTATION_FULL_CATALOG_FALLBACK_CAP,
      include: PRODUCT_VARIANT_INCLUDE,
    });
    await this.resolveProductPrices(storeId, fallback);
    return fallback;
  }

  // docs/PRD-sales-agent-tool-calling-architecture.md بخش ۳.۲ — فیکس باگ واقعی کاربر (پیام
  // فالو-آپ «من اگر بخوام فرانت بشم چی؟» گم می‌شد چون parseIntent هیچ تاریخچه‌ای نمی‌دید).
  // ConversationEvent همین الان این داده را دارد، هیچ migration جدا لازم نیست. پیام همین نوبت
  // (که handleMessage همین الان، قبل از فراخوانی runFullAgentTurn، ثبت کرده) عمداً از تاریخچه
  // کنار گذاشته می‌شود — چون همان متن جدا به‌عنوان prompt به generateText پاس داده می‌شود
  private async buildRecentTranscript(conversationId: string): Promise<string> {
    const events = await this.prisma.conversationEvent.findMany({
      where: {
        conversationId,
        type: { in: ['CUSTOMER_MESSAGE', 'AGENT_REPLY'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 9,
    });
    const history = events.slice(1).reverse();
    if (history.length === 0) return '';
    return history
      .map((e) => {
        const payload = e.payload as { text?: string };
        const speaker = e.type === 'CUSTOMER_MESSAGE' ? 'مشتری' : 'فروشنده';
        return `${speaker}: ${payload.text ?? ''}`;
      })
      .join('\n');
  }

  // docs/PRD-sales-agent-response-strategy-ab.md بخش ۱ (Track B) — جایگزین agent-محور همین یک
  // تصمیم (captionWithRelevance)، نه کل conversation-engine. برخلاف Track A که سیگنال‌های
  // needType/storeRelevance/pitchReadiness را از بیرون می‌گیرد، این مسیر خودش با ابزار تصمیم
  // می‌گیرد که آیا اطلاعات کافی برای معرفی محصول دارد یا باید سوال روشن‌کننده بپرسد — هیچ سیگنال
  // از‌پیش‌محاسبه‌شده‌ای به آن داده نمی‌شود، فقط پیام مشتری و دو ابزار. قرارداد خروجی عمداً دقیقاً
  // همان { text, relevantProductIds } است تا مستقیماً جای‌گزین Track A باشد (relevantProductIds
  // خالی یعنی «سوال روشن‌کننده پرسید، هنوز محصولی نشان نده» — هم‌ارز شاخه‌ی CLARIFY در Track A)
  private async callAgentCaptionWithRelevance(
    facts: string,
    model: string,
    category: string | null,
    storeId: string,
    candidateProductIds: string[],
    customerQuestion?: string,
    skipGreeting = false,
  ): Promise<{
    text: string;
    relevantProductIds: string[];
    inputTokens: number;
    outputTokens: number;
  }> {
    const tone = toneForCategory(category);
    const client = this.aiProvider.buildClient(undefined, {
      supportsStructuredOutputs: true,
    })(model);

    const getProductDetails = tool({
      description:
        'جزئیات کامل یک محصول (توضیحات کامل، قیمت، موجودی) را با شناسه‌اش برمی‌گرداند — قبل از تصمیم نهایی برای سنجش تناسب محصول با نیاز مشتری از این استفاده کن',
      inputSchema: z.object({ productId: z.string() }),
      execute: async ({ productId }: { productId: string }) => {
        const product = await this.prisma.product.findUnique({
          where: { id: productId, ...BUYER_VISIBLE },
          include: PRODUCT_VARIANT_INCLUDE,
        });
        if (!product || product.storeId !== storeId) {
          return { error: 'محصولی با این شناسه در این فروشگاه پیدا نشد' };
        }
        await this.resolveProductPrices(storeId, [product]);
        return {
          id: product.id,
          name: product.name,
          basePrice: product.basePrice,
          inStock: displayStock(product) > 0,
          description: product.description
            ? truncateDescriptionForFacts(product.description, DESCRIPTION_FACTS_SINGLE_MAX_CHARS)
            : null,
          specs: parseProductSpecs(product.specs),
          ...(hasVariantOptions(product)
            ? { options: this.describeVariantOptions(product).trim() }
            : {}),
        };
      },
    });

    const searchProductsTool = tool({
      description:
        'در کاتالوگ فروشگاه بر اساس یک عبارت جست‌وجو می‌کند — اگر کاندیدهای اولیه کافی به‌نظر نمی‌رسند از این استفاده کن تا محصول مرتبط‌تری در کل فروشگاه پیدا کنی',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }: { query: string }) => {
        const results = await this.searchProducts(storeId, query);
        return results.map((p) => ({
          id: p.id,
          name: p.name,
          basePrice: p.basePrice,
          inStock: displayStock(p) > 0,
        }));
      },
    });

    // ابزار پایانی بدون execute — مدل باید دقیقاً با همین ساختار پاسخ نهایی را اعلام کند؛ چون
    // execute ندارد، حلقه‌ی چندمرحله‌ای SDK بعد از این فراخوان خودش متوقف می‌شود (نیازی به
    // منطق پایان‌دهی دستی نیست)
    const respondToCustomer = tool({
      description:
        'پاسخ نهایی به مشتری را اعلام می‌کند — این باید همیشه آخرین قدم تو باشد، دقیقاً یک‌بار صدا زده شود',
      inputSchema: z.object({
        text: z
          .string()
          .describe(
            'متن فارسی کوتاه (حداکثر ۲-۳ جمله) برای مشتری — یا معرفی/پاسخ بر اساس محصول(های) واقعی، یا اگر اطلاعات کافی نداری یک سوال روشن‌کننده (بدون نام‌بردن محصول)',
          ),
        relevantProductIds: z
          .array(z.string())
          .describe(
            'شناسه‌ی محصول(های) واقعاً مرتبط برای نمایش کارت — اگر داری سوال روشن‌کننده می‌پرسی، این را خالی بگذار',
          ),
      }),
    });

    setCallSite('caption_agentic');
    const result = await generateText({
      maxRetries: LLM_MAX_RETRIES,
      model: client,
      tools: {
        get_product_details: getProductDetails,
        search_products: searchProductsTool,
        respond_to_customer: respondToCustomer,
      },
      stopWhen: stepCountIs(4),
      system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. لحن نوشتار باید ${tone}
باشد. کاندیدهای اولیه‌ای که از جست‌وجوی پیام مشتری پیدا شده‌اند، پایین در «واقعیت‌ها» آمده‌اند
(نام/قیمت/موجودی/توضیحات). قبل از تصمیم نهایی لازم نیست حتماً ابزاری صدا بزنی — اگر واقعیت‌های
داده‌شده برای تصمیم کافی‌اند، مستقیم respond_to_customer را صدا بزن.
فقط و فقط بر اساس واقعیت‌های واقعی (داده‌شده یا از ابزارها) تصمیم بگیر — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در این واقعیت‌ها نیامده اختراع نکن، و هرگز تعداد دقیق موجودی انبار را اعلام نکن (حتی
اگر مشتری صریح بپرسد)، فقط «موجود است» یا «فعلاً ناموجود».
تصمیم نهایی را با respond_to_customer اعلام کن (دقیقاً یک‌بار، به‌عنوان آخرین قدم):
۱. اگر هدف واقعی مشتری و تناسبش با یکی از محصولات برایت روشن است، یک پیام کوتاه و دوستانه با
حداکثر ۳ شناسه‌ی مرتبط‌ترین محصول بساز (اگر یک محصول به‌تنهایی برنده‌ی مشخصی است، فقط همان یکی).
۲. اگر هدف مشتری کلی/مبهم است و واقعاً نمی‌توانی مطمئن باشی کدام محصول مناسب است، به‌جای حدس
کورکورانه فقط یک سوال کوتاه و مشخص بپرس تا هدف را دقیق‌تر کنی — در این حالت هیچ محصولی نام نبر و
relevantProductIds را خالی بگذار.${
        customerQuestion
          ? '\nمشتری زیر «سوال مشتری» یک سوال مشخص پرسیده — اگر واقعیت‌ها جوابش را می‌دهند، مستقیم و دقیق جواب بده؛ اگر نه، صادقانه بگو این اطلاعات را نداری (این هم یک پاسخ معتبر است، نیازی به سوال روشن‌کننده نیست).'
          : ''
      }${
        skipGreeting
          ? '\nیک پیام خوش‌آمد جداگانه همین الان قبل از این پاسخ برای مشتری فرستاده شده — فیلد text را هرگز با «سلام»/«خوش اومدی»/هر نوع احوال‌پرسی شروع نکن.'
          : ''
      }
شناسه‌های کاندید اولیه: ${candidateProductIds.join(', ')}`,
      prompt: customerQuestion
        ? `سوال مشتری: ${customerQuestion}\n\nواقعیت‌ها:\n${facts}`
        : facts,
      temperature: 0.3,
    });

    const finalCall = result.toolCalls.find(
      (c) => c.toolName === 'respond_to_customer',
    ) as { input: { text: string; relevantProductIds: string[] } } | undefined;

    if (!finalCall) {
      // مدل به سقف قدم رسید بدون صدا زدن respond_to_customer — fallback امن پایین (در
      // agentCaptionWithRelevance) این حالت را هم مثل خطا مدیریت می‌کند
      throw new Error(
        'Agent did not call respond_to_customer within step limit',
      );
    }

    return {
      text: finalCall.input.text.trim(),
      relevantProductIds: finalCall.input.relevantProductIds,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };
  }

  // همون fallback دومرحله‌ای captionWithRelevance — اگر هر دو تلاش شکست خورد (شامل نرسیدن به
  // respond_to_customer)، fallback امن «همه‌ی کاندیدها مرتبط‌اند» است، نه اینکه هیچ محصولی نشان
  // داده نشود
  private async agentCaptionWithRelevance(
    facts: string,
    conversation: ConversationWithStore,
    candidateProductIds: string[],
    customerQuestion?: string,
    skipGreeting = false,
  ): Promise<{ text: string; relevantProductIds: string[] }> {
    const primaryModel = resolveModel(conversation.abVariant);
    const category = conversation.store.category;
    const started = Date.now();
    try {
      const { text, relevantProductIds, inputTokens, outputTokens } =
        await this.callAgentCaptionWithRelevance(
          facts,
          primaryModel,
          category,
          conversation.storeId,
          candidateProductIds,
          customerQuestion,
          skipGreeting,
        );
      await this.logAiCall(
        conversation,
        'AGENT_CAPTION',
        true,
        Date.now() - started,
      );
      await this.logTextCreditUsage(
        conversation,
        primaryModel,
        inputTokens,
        outputTokens,
      );
      return { text, relevantProductIds };
    } catch (err) {
      this.logger.error(
        `agentCaptionWithRelevance failed (model=${primaryModel}, conversation=${conversation.id})`,
        err as Error,
      );
      await this.logAiCall(
        conversation,
        'AGENT_CAPTION',
        false,
        Date.now() - started,
      );
      if (primaryModel === defaultModel()) {
        return { text: facts, relevantProductIds: candidateProductIds };
      }
      const fallbackStarted = Date.now();
      try {
        const { text, relevantProductIds, inputTokens, outputTokens } =
          await this.callAgentCaptionWithRelevance(
            facts,
            defaultModel(),
            category,
            conversation.storeId,
            candidateProductIds,
            customerQuestion,
            skipGreeting,
          );
        await this.logAiCall(
          conversation,
          'AGENT_CAPTION',
          true,
          Date.now() - fallbackStarted,
        );
        await this.logTextCreditUsage(
          conversation,
          defaultModel(),
          inputTokens,
          outputTokens,
        );
        return { text, relevantProductIds };
      } catch (fallbackErr) {
        this.logger.error(
          `agentCaptionWithRelevance fallback failed (model=${defaultModel()}, conversation=${conversation.id})`,
          fallbackErr as Error,
        );
        await this.logAiCall(
          conversation,
          'AGENT_CAPTION',
          false,
          Date.now() - fallbackStarted,
        );
        const chained = await this.tryModelFallbackChain(
          conversation,
          'AGENT_CAPTION',
          'agentCaptionWithRelevance',
          (model) =>
            this.callAgentCaptionWithRelevance(
              facts,
              model,
              category,
              conversation.storeId,
              candidateProductIds,
              customerQuestion,
              skipGreeting,
            ).then(
              ({ text, relevantProductIds, inputTokens, outputTokens }) => ({
                result: { text, relevantProductIds },
                inputTokens,
                outputTokens,
              }),
            ),
        );
        return (
          chained ?? { text: facts, relevantProductIds: candidateProductIds }
        );
      }
    }
  }

  // docs/PRD-sales-agent-tool-calling-architecture.md — کل این بخش. برخلاف
  // callAgentCaptionWithRelevance (Track B) که فقط یک تصمیم (doBrowse) را agent-محور می‌کند،
  // این یک نوبت کامل مکالمه (سبد/سفارش/تخفیف/FAQ/ارجاع انسانی) را با یک زنجیره‌ی
  // generateText چندمرحله‌ای تصمیم می‌گیرد — جایگزین کامل parseIntent+switch+do* برای
  // مکالمه‌هایی که responseStrategy=FULL_AGENT دارند.
  // docs/PRD-sales-agent-sales-state-machine.md §۱۰.۱ — بخش «اطلاعات فروشگاه»؛ از
  // buildFullAgentSystemPrompt بیرون کشیده شد تا مسیر ماشین‌حالت هم همان را استفاده کند
  private async buildStoreProfileText(
    conversation: ConversationWithStore,
  ): Promise<string> {
    const store = conversation.store;
    const shippingRulesSummary = await formatShippingRulesSummary(
      this.prisma,
      conversation.storeId,
    );
    return [
      store.category && `حوزه‌ی فعالیت: ${store.category}`,
      store.brandIntro && `معرفی فروشگاه: ${store.brandIntro}`,
      store.shippingInfo && `ارسال: ${store.shippingInfo}`,
      formatShippingDays(store.shippingDaysMin, store.shippingDaysMax) &&
        `زمان ارسال: ${formatShippingDays(store.shippingDaysMin, store.shippingDaysMax)}`,
      shippingRulesSummary &&
        `هزینه‌ی ارسال به‌تفکیک استان:\n${shippingRulesSummary}`,
      store.returnPolicy && `شرایط مرجوعی/گارانتی: ${store.returnPolicy}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async buildFullAgentSystemPrompt(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    catalogFacts: string,
    transcript: string,
    nudgeActive: boolean,
    persuasionEnabled: boolean,
    urgentDiscount: { code: string; expiresAt: Date } | null,
    leadCaptureOnly: boolean,
    leadCaptureNudgeActive: boolean,
  ): Promise<string> {
    const tone = toneForCategory(conversation.store.category);
    const store = conversation.store;
    const storeProfile = await this.buildStoreProfileText(conversation);
    const cartSummary = ctx.cart.length
      ? `سبد فعلی مشتری: ${ctx.cart.map((i) => `${i.name} × ${i.qty}`).join('، ')} — جمع ${this.cartTotal(ctx.cart)} تومان`
      : 'سبد فعلی مشتری خالی است.';

    // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — خودگزارش‌دهی نوبت قبل (CustomerState)، به‌عنوان یک fact برای
    // تداوم تحلیل؛ به مدل می‌گوییم این تحلیل قبلی است تا اگر پیام تازه چیزی را عوض کرد، خودش
    // در customerState همین نوبت به‌روزش کند، نه این‌که کورکورانه همان مقدار قبلی را تکرار کند
    const customerState = ctx.customerState;
    const customerStateSummary = customerState
      ? `\nآخرین تحلیل خودت از وضعیت مشتری (نوبت قبل — اگر پیام تازه چیزی را عوض کرد، در ` +
        `customerState همین پاسخ به‌روزش کن): درد شناسایی‌شده: ${customerState.pain ?? 'هنوز نامشخص'}، ` +
        `قابل‌حل‌بودن با این فروشگاه: ${
          { UNKNOWN: 'نامشخص', YES: 'بله', PARTIAL: 'تا حدی', NO: 'خیر' }[
            customerState.painSolvable
          ]
        }، همدلی نشان‌داده‌شده: ${customerState.empathyShown ? 'بله' : 'خیر'}، توجه/درگیری مشتری: ${
          customerState.attentionCaptured ? 'دارد' : 'ندارد'
        }، مرحله: ${
          {
            DISCOVERY: 'کشف نیاز',
            PAIN_IDENTIFIED: 'درد شناسایی‌شده',
            PITCHED: 'راه‌حل پرزنت‌شده',
            OBJECTION: 'اعتراض/تردید',
            READY: 'آماده‌ی اقدام',
            STALLED: 'گیرکرده/بدون پیشرفت',
            LOST: 'ازدست‌رفته',
          }[customerState.stage]
        }.\n`
      : '';
    const painNotSolvable = customerState?.painSolvable === 'NO';
    const empathyMissing =
      customerState?.stage === 'PAIN_IDENTIFIED' &&
      customerState.empathyShown === false;

    return `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی و با ابزارهای زیر مستقیماً سبد/
سفارش مشتری را مدیریت می‌کنی، نه فقط متن می‌نویسی. لحن نوشتار باید ${tone} باشد.
${storeProfile ? `\nاطلاعات فروشگاه:\n${storeProfile}\n` : ''}
چند نمونه از محصولات فروشگاه (فقط چند نمونه‌ی کلی، لزوماً ربطی به بحث فعلی ندارند — برای
جست‌وجوی دقیق یا محصولی که اینجا نیست از search_products استفاده کن):
${catalogFacts}

${cartSummary}
${customerStateSummary}${
      ctx.lastShownProducts?.length
        ? `\nآخرین محصولاتی که واقعاً در همین مکالمه مطرح/پیشنهاد شده‌اند: ${ctx.lastShownProducts.map((p) => p.name).join('، ')}\n`
        : ''
    }${
      transcript
        ? `\nتاریخچه‌ی اخیر مکالمه (حتماً برای فهمیدن منظور پیام‌های ناقص/ادامه‌دار مشتری — مثل «پس اگه بخوام X بشم چی؟» بعد از بحث قبلی — این را در نظر بگیر):\n${transcript}\n`
        : ''
    }
قوانین حیاتی:
- هیچ عدد/اسم/شماره‌ای که از ابزارها یا واقعیت‌های بالا نیامده اختراع نکن.
- هر کد/شناسه‌ی حروفی-عددی (مثل کد تخفیف) که از ابزارها برگشته، در پاسخ باید عیناً و حرف‌به‌حرف
  همان‌طور تکرار شود — هیچ تبدیل رقم فارسی⇄انگلیسی، تغییر حروف، یا بازنویسی روی آن مجاز نیست.
- هرگز تعداد دقیق موجودی انبار را اعلام نکن، فقط «موجود است» یا «فعلاً ناموجود».
- اگر پیام مشتری مبهم است و اسم هیچ محصولی را نمی‌آورد (مثل «کدوم بهتره؟»، «فرقشون چیه؟»،
  «همینو بذار تو سبد»)، منظورش تقریباً همیشه «آخرین محصولاتی که مطرح/پیشنهاد شده‌اند» (بالا) یا
  تاریخچه‌ی اخیر مکالمه است — نه «چند نمونه از محصولات فروشگاه» که فقط یک نمونه‌ی کلی و تصادفی از
  کل کاتالوگ است و ممکن است هیچ ربطی به این گفتگوی خاص نداشته باشد.
- قبل از هر ادعای قیمت/موجودی/جزئیات محصولی که در کاتالوگ اولیه نبود، حتماً search_products یا
  get_product_details را صدا بزن — حدس نزن.
- اگر مشتری سؤال واقعی درباره‌ی خودِ فروشگاه/کسب‌وکار پرسید (قیمت/هزینه/شرایط/زمان و مشابه) و
  جوابش قبلاً همین مکالمه داده شده (در تاریخچه‌ی بالا) یا در باکس دانش/پروفایل فروشگاه هست، همان
  جواب واقعی را بده — حتی اگر عبارت سؤال با دفعه‌ی قبل فرق دارد (مثل «قیمتش چقدره؟» در برابر
  «هزینه‌ها چقدره؟»). هرگز نگو «مشخص نیست» یا مستقیم به سمت CTA/جمع‌آوری لید نرو مگر اول یک‌بار
  answer_faq را با همان سؤال مشتری هم صدا زده باشی؛ «علاقه نشان‌دادن مشتری» هیچ‌وقت بهانه‌ای برای
  رد‌کردن یک سؤال واقعی و بی‌جواب‌گذاشتنش نیست — اول جواب بده، بعد به سمت CTA ادامه بده.
- افزودن/حذف واقعی از سبد فقط با update_cart انجام می‌شود؛ هرگز فقط در متن بگو «به سبد اضافه
  کردم» بدون این‌که واقعاً این ابزار را صدا زده باشی.
${
  leadCaptureOnly
    ? '- این فروشگاه هیچ create_order ندارد؛ پایین دستورالعمل جدا برایش آمده.'
    : `- ثبت نهایی سفارش فقط با create_order انجام می‌شود، و فقط وقتی مشتری صریحاً تایید خرید کرده
  (نه صرفاً علاقه نشان داده). بعد از صدازدنش سیستم خودش آدرس/روش پرداخت را می‌پرسد؛ تو دیگر
  respond_to_customer را صدا نزن.`
}
- اگر مشتری درباره‌ی وضعیت سفارشی که قبلاً ثبت کرده سؤال کرد (مثل «سفارشم کجاست؟»/«سفارشم چی
  شد؟»)، همیشه اول check_order_status را صدا بزن و همان جواب را بده — فقط اگر سفارشی پیدا نشد یا
  سؤال واقعاً چیز دیگری بود (شکایت، درخواست تغییر/لغو که ابزاری برایش نداری)، request_human_handoff
  را صدا بزن.
- اگر مشتری مشکل پرداخت یا سوال پس از خرید دیگری دارد که با ابزارهای بالا قابل‌حل نیست، یا صریح
  خواست با یک آدم/پشتیبان صحبت کند، request_human_handoff را صدا بزن و دیگر respond_to_customer
  را صدا نزن — مکالمه همان‌جا تمام می‌شود.
- اگر مشتری قبلاً محصولی را دیده (طبق سبد/تاریخچه/آخرین محصولات مطرح‌شده بالا) و فقط سوال عمومی
  پرسید، به‌جای جست‌وجوی دوباره روی همان محصول تمرکز کن.
- اگر مشتری صریح عکس بیشتر خواست، از show_product_photos استفاده کن.
- اگر مشتری صریح بین ۲-۳ محصول مشخص مردد است یا مقایسه خواسته («این بهتره یا اون؟»، «فرقشون
  چیه؟» با حداقل دو محصول مشخص)، از compare_products استفاده کن تا جدولی کنار هم نشان داده شود
  — به‌جای توضیح تفاوت‌ها فقط در متن آزاد.
- همیشه اول به سوال/نیاز واقعی مشتری یک جواب کامل و مفید بده، بعد (در صورت نیاز) پیشنهاد یا دعوت
  به خرید را اضافه کن — نه برعکس.
- (docs/PRD-sales-agent-consultative-recommendation.md) اگر پیام مشتری توصیف یک وضعیت/مشکل/هدف
  است (نه اسم مشخص یک محصول)، مثل یک مشاور رفتار کن: اگر با قطعیت می‌دانی کدام محصول واقعی
  مناسب است، همان یکی (حداکثر دو تای کاملاً هم‌سطح) را با توضیح کوتاهِ *چرا* دقیقاً برای همین نیاز
  مناسب است پیشنهاد بده — نه تعریف کلی/تبلیغاتی. اگر واقعاً مطمئن نیستی، به‌جای حدس‌زدن یک سوال
  کوتاه و مشخص بپرس تا هدف را دقیق‌تر کنی؛ در این حالت هیچ محصولی نام نبر و relevantProductIds را
  خالی بگذار — **مگر این‌که دستورالعمل «مشتری چند پیام پشت‌سرهم فقط سوال پرسیده» (اگر پایین
  حاضر باشد) فعال باشد، که آن وقت آن دستورالعمل اولویت دارد** (پایین توضیح داده شده دقیقاً چطور).
  لازم نیست عبارت جست‌وجو دقیقاً با اسم محصول یکی باشد — search_products روی توضیحات هم
  جست‌وجو می‌کند و اگر هیچ‌چیز پیدا نکرد کل کاتالوگ را برمی‌گرداند تا خودت تناسب را تشخیص بدهی.
- در پایان (مگر وقتی request_human_handoff زده‌ای)، همیشه دقیقاً یک‌بار respond_to_customer را
  به‌عنوان آخرین قدم صدا بزن؛ relevantProductIds فقط باید شامل محصولاتی باشد که واقعاً در متن
  همین پاسخ نام برده‌ای یا معرفی کرده‌ای — هرگز شناسه‌ی محصولی از «چند نمونه از محصولات فروشگاه»
  را صرفاً چون آنجا بوده اضافه نکن، مگر همان محصول را واقعاً در پاسخت هم آورده باشی.
${persuasionEnabled ? `\n\n${PERSUASION_INSTRUCTION}` : ''}${
      persuasionEnabled && urgentDiscount
        ? `\n\nیک کد تخفیف واقعی و زمان‌دار همین الان فعال است: «${urgentDiscount.code}»، تا ${urgentDiscount.expiresAt.toLocaleString('fa-IR')} معتبر. اگر به مکالمه مرتبط است (مثلاً مشتری نزدیک تصمیم خرید است)، می‌توانی طبیعی مطرحش کنی، حتی اگر مشتری نپرسیده — وگرنه لازم نیست اشاره کنی.`
        : ''
    }${nudgeActive ? `\n\n${OPEN_QUESTION_NUDGE_INSTRUCTION}` : ''}${
      leadCaptureOnly
        ? `\n\n${buildLeadCaptureOnlyInstruction()}`
        : ''
    }${leadCaptureNudgeActive ? `\n\n${LEAD_CAPTURE_NUDGE_INSTRUCTION}` : ''}${
      painNotSolvable ? `\n\n${PAIN_NOT_SOLVABLE_INSTRUCTION}` : ''
    }${empathyMissing ? `\n\n${EMPATHY_MISSING_INSTRUCTION}` : ''}`;
  }

  // ACE-2 — نسخه‌ی بلوک‌بندی‌شده برای کش prompt (فقط موتور بهینه، لایه‌ی promptCache). تابع پایدار بالا
  // عمداً دست‌نخورده است (I-9). ترتیب: قانون‌های ثابت ⟦بلوک ۱⟧ | فروشگاه ⟦بلوک ۲⟧ | کاتالوگ ⟦بلوک ۳⟧ | پویا ⟦بلوک ۴⟧.
  // هیچ timestamp/شمارنده‌ای در بلوک ۱ تا ۳ نیست؛ هر چیز زمان‌دار یا وابسته‌ به نوبت در بلوک ۴ است.
  private async buildFullAgentSystemPromptLean(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    catalogFacts: string,
    transcript: string,
    nudgeActive: boolean,
    persuasionEnabled: boolean,
    urgentDiscount: { code: string; expiresAt: Date } | null,
    leadCaptureOnly: boolean,
    leadCaptureNudgeActive: boolean,
    briefOn = false,
  ): Promise<string> {
    const tone = toneForCategory(conversation.store.category);
    const store = conversation.store;
    const storeProfile = await this.buildStoreProfileText(conversation);
    const cartSummary = ctx.cart.length
      ? `سبد فعلی مشتری: ${ctx.cart.map((i) => `${i.name} × ${i.qty}`).join('، ')} — جمع ${this.cartTotal(ctx.cart)} تومان`
      : 'سبد فعلی مشتری خالی است.';

    // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — خودگزارش‌دهی نوبت قبل (CustomerState)، به‌عنوان یک fact برای
    // تداوم تحلیل؛ به مدل می‌گوییم این تحلیل قبلی است تا اگر پیام تازه چیزی را عوض کرد، خودش
    // در customerState همین نوبت به‌روزش کند، نه این‌که کورکورانه همان مقدار قبلی را تکرار کند
    const customerState = ctx.customerState;
    const customerStateSummary = customerState
      ? `\nآخرین تحلیل خودت از وضعیت مشتری (نوبت قبل — اگر پیام تازه چیزی را عوض کرد، در ` +
        `customerState همین پاسخ به‌روزش کن): درد شناسایی‌شده: ${customerState.pain ?? 'هنوز نامشخص'}، ` +
        `قابل‌حل‌بودن با این فروشگاه: ${
          { UNKNOWN: 'نامشخص', YES: 'بله', PARTIAL: 'تا حدی', NO: 'خیر' }[
            customerState.painSolvable
          ]
        }، همدلی نشان‌داده‌شده: ${customerState.empathyShown ? 'بله' : 'خیر'}، توجه/درگیری مشتری: ${
          customerState.attentionCaptured ? 'دارد' : 'ندارد'
        }، مرحله: ${
          {
            DISCOVERY: 'کشف نیاز',
            PAIN_IDENTIFIED: 'درد شناسایی‌شده',
            PITCHED: 'راه‌حل پرزنت‌شده',
            OBJECTION: 'اعتراض/تردید',
            READY: 'آماده‌ی اقدام',
            STALLED: 'گیرکرده/بدون پیشرفت',
            LOST: 'ازدست‌رفته',
          }[customerState.stage]
        }.\n`
      : '';
    const painNotSolvable = customerState?.painSolvable === 'NO';
    const empathyMissing =
      customerState?.stage === 'PAIN_IDENTIFIED' &&
      customerState.empathyShown === false;

    const block1 = `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی و با ابزارهای زیر مستقیماً سبد/
سفارش مشتری را مدیریت می‌کنی، نه فقط متن می‌نویسی.

قوانین حیاتی:
- هیچ عدد/اسم/شماره‌ای که از ابزارها یا واقعیت‌های بالا نیامده اختراع نکن.
- هر کد/شناسه‌ی حروفی-عددی (مثل کد تخفیف) که از ابزارها برگشته، در پاسخ باید عیناً و حرف‌به‌حرف
  همان‌طور تکرار شود — هیچ تبدیل رقم فارسی⇄انگلیسی، تغییر حروف، یا بازنویسی روی آن مجاز نیست.
- هرگز تعداد دقیق موجودی انبار را اعلام نکن، فقط «موجود است» یا «فعلاً ناموجود».
- اگر پیام مشتری مبهم است و اسم هیچ محصولی را نمی‌آورد (مثل «کدوم بهتره؟»، «فرقشون چیه؟»،
  «همینو بذار تو سبد»)، منظورش تقریباً همیشه «آخرین محصولاتی که مطرح/پیشنهاد شده‌اند» (بالا) یا
  تاریخچه‌ی اخیر مکالمه است — نه «چند نمونه از محصولات فروشگاه» که فقط یک نمونه‌ی کلی و تصادفی از
  کل کاتالوگ است و ممکن است هیچ ربطی به این گفتگوی خاص نداشته باشد.
- قبل از هر ادعای قیمت/موجودی/جزئیات محصولی که در کاتالوگ اولیه نبود، حتماً search_products یا
  get_product_details را صدا بزن — حدس نزن.
${STRUCTURED_SEARCH_RULES}
- اگر مشتری سؤال واقعی درباره‌ی خودِ فروشگاه/کسب‌وکار پرسید (قیمت/هزینه/شرایط/زمان و مشابه) و
  جوابش قبلاً همین مکالمه داده شده (در تاریخچه‌ی بالا) یا در باکس دانش/پروفایل فروشگاه هست، همان
  جواب واقعی را بده — حتی اگر عبارت سؤال با دفعه‌ی قبل فرق دارد (مثل «قیمتش چقدره؟» در برابر
  «هزینه‌ها چقدره؟»). هرگز نگو «مشخص نیست» یا مستقیم به سمت CTA/جمع‌آوری لید نرو مگر اول یک‌بار
  answer_faq را با همان سؤال مشتری هم صدا زده باشی؛ «علاقه نشان‌دادن مشتری» هیچ‌وقت بهانه‌ای برای
  رد‌کردن یک سؤال واقعی و بی‌جواب‌گذاشتنش نیست — اول جواب بده، بعد به سمت CTA ادامه بده.
- افزودن/حذف واقعی از سبد فقط با update_cart انجام می‌شود؛ هرگز فقط در متن بگو «به سبد اضافه
  کردم» بدون این‌که واقعاً این ابزار را صدا زده باشی.
- اگر مشتری درباره‌ی وضعیت سفارشی که قبلاً ثبت کرده سؤال کرد (مثل «سفارشم کجاست؟»/«سفارشم چی
  شد؟»)، همیشه اول check_order_status را صدا بزن و همان جواب را بده — فقط اگر سفارشی پیدا نشد یا
  سؤال واقعاً چیز دیگری بود (شکایت، درخواست تغییر/لغو که ابزاری برایش نداری)، request_human_handoff
  را صدا بزن.
- اگر مشتری مشکل پرداخت یا سوال پس از خرید دیگری دارد که با ابزارهای بالا قابل‌حل نیست، یا صریح
  خواست با یک آدم/پشتیبان صحبت کند، request_human_handoff را صدا بزن و دیگر respond_to_customer
  را صدا نزن — مکالمه همان‌جا تمام می‌شود.
- اگر مشتری قبلاً محصولی را دیده (طبق سبد/تاریخچه/آخرین محصولات مطرح‌شده بالا) و فقط سوال عمومی
  پرسید، به‌جای جست‌وجوی دوباره روی همان محصول تمرکز کن.
${briefOn ? `${BRIEF_PROMPT_RULE}\n` : ''}- اگر مشتری صریح عکس بیشتر خواست، از show_product_photos استفاده کن.
- اگر مشتری صریح بین ۲-۳ محصول مشخص مردد است یا مقایسه خواسته («این بهتره یا اون؟»، «فرقشون
  چیه؟» با حداقل دو محصول مشخص)، از compare_products استفاده کن تا جدولی کنار هم نشان داده شود
  — به‌جای توضیح تفاوت‌ها فقط در متن آزاد.
- همیشه اول به سوال/نیاز واقعی مشتری یک جواب کامل و مفید بده، بعد (در صورت نیاز) پیشنهاد یا دعوت
  به خرید را اضافه کن — نه برعکس.
- (docs/PRD-sales-agent-consultative-recommendation.md) اگر پیام مشتری توصیف یک وضعیت/مشکل/هدف
  است (نه اسم مشخص یک محصول)، مثل یک مشاور رفتار کن: اگر با قطعیت می‌دانی کدام محصول واقعی
  مناسب است، همان یکی (حداکثر دو تای کاملاً هم‌سطح) را با توضیح کوتاهِ *چرا* دقیقاً برای همین نیاز
  مناسب است پیشنهاد بده — نه تعریف کلی/تبلیغاتی. اگر واقعاً مطمئن نیستی، به‌جای حدس‌زدن یک سوال
  کوتاه و مشخص بپرس تا هدف را دقیق‌تر کنی؛ در این حالت هیچ محصولی نام نبر و relevantProductIds را
  خالی بگذار — **مگر این‌که دستورالعمل «مشتری چند پیام پشت‌سرهم فقط سوال پرسیده» (اگر پایین
  حاضر باشد) فعال باشد، که آن وقت آن دستورالعمل اولویت دارد** (پایین توضیح داده شده دقیقاً چطور).
  لازم نیست عبارت جست‌وجو دقیقاً با اسم محصول یکی باشد — search_products روی توضیحات هم
  جست‌وجو می‌کند و اگر هیچ‌چیز پیدا نکرد کل کاتالوگ را برمی‌گرداند تا خودت تناسب را تشخیص بدهی.
- در پایان (مگر وقتی request_human_handoff زده‌ای)، همیشه دقیقاً یک‌بار respond_to_customer را
  به‌عنوان آخرین قدم صدا بزن؛ relevantProductIds فقط باید شامل محصولاتی باشد که واقعاً در متن
  همین پاسخ نام برده‌ای یا معرفی کرده‌ای — هرگز شناسه‌ی محصولی از «چند نمونه از محصولات فروشگاه»
  را صرفاً چون آنجا بوده اضافه نکن، مگر همان محصول را واقعاً در پاسخت هم آورده باشی.`;

    const block2 = `لحن نوشتار باید ${tone} باشد.
${storeProfile ? `\nاطلاعات فروشگاه:\n${storeProfile}\n` : ''}
قوانین ویژه‌ی این فروشگاه:
${
  leadCaptureOnly
    ? '- این فروشگاه هیچ create_order ندارد؛ پایین دستورالعمل جدا برایش آمده.'
    : `- ثبت نهایی سفارش فقط با create_order انجام می‌شود، و فقط وقتی مشتری صریحاً تایید خرید کرده
  (نه صرفاً علاقه نشان داده). بعد از صدازدنش سیستم خودش آدرس/روش پرداخت را می‌پرسد؛ تو دیگر
  respond_to_customer را صدا نزن.`
}${persuasionEnabled ? `\n\n${PERSUASION_INSTRUCTION}` : ''}${
      leadCaptureOnly ? `\n\n${buildLeadCaptureOnlyInstruction()}` : ''
    }`;

    const block3 = `چند نمونه از محصولات فروشگاه (فقط چند نمونه‌ی کلی، لزوماً ربطی به بحث فعلی ندارند — برای
جست‌وجوی دقیق یا محصولی که اینجا نیست از search_products استفاده کن):
${catalogFacts}`;

    const lastSearchLine = describeLastSearch(ctx.lastSearch);
    const block4 = `${cartSummary}
${customerStateSummary}${
      ctx.lastShownProducts?.length
        ? `\nآخرین محصولاتی که واقعاً در همین مکالمه مطرح/پیشنهاد شده‌اند: ${ctx.lastShownProducts.map((p) => p.name).join('، ')}\n`
        : ''
    }${
      lastSearchLine ? `\n${lastSearchLine}\n` : ''
    }${
      transcript
        ? `\nتاریخچه‌ی اخیر مکالمه (حتماً برای فهمیدن منظور پیام‌های ناقص/ادامه‌دار مشتری — مثل «پس اگه بخوام X بشم چی؟» بعد از بحث قبلی — این را در نظر بگیر):\n${transcript}\n`
        : ''
    }${
      persuasionEnabled && urgentDiscount
        ? `\n\nیک کد تخفیف واقعی و زمان‌دار همین الان فعال است: «${urgentDiscount.code}»، تا ${urgentDiscount.expiresAt.toLocaleString('fa-IR')} معتبر. اگر به مکالمه مرتبط است (مثلاً مشتری نزدیک تصمیم خرید است)، می‌توانی طبیعی مطرحش کنی، حتی اگر مشتری نپرسیده — وگرنه لازم نیست اشاره کنی.`
        : ''
    }${nudgeActive ? `\n\n${OPEN_QUESTION_NUDGE_INSTRUCTION}` : ''}${
      leadCaptureNudgeActive ? `\n\n${LEAD_CAPTURE_NUDGE_INSTRUCTION}` : ''
    }${painNotSolvable ? `\n\n${PAIN_NOT_SOLVABLE_INSTRUCTION}` : ''}${
      empathyMissing ? `\n\n${EMPATHY_MISSING_INSTRUCTION}` : ''
    }`;

    return [block1, block2, block3, block4].join(`\n${PROMPT_CACHE_BREAK}\n`);
  }

  // docs/PRD-sales-agent-tool-calling-architecture.md بخش ۳.۴ — نرده‌ی حفاظتی حیاتی: قیمت/
  // موجودی/مبلغ سفارش هرگز از متن تولیدی مدل گرفته نمی‌شود، همیشه از خروجی واقعی ابزاری که
  // همین نوبت صدا زده شده
  private deriveFullAgentUiBlock(args: {
    orderResult: {
      cardNumber: string;
      ownerName: string;
      amount: number;
    } | null;
    cartResult: { cart: CartItem[]; total: number } | null;
    photosResult: {
      productId: string;
      productName: string;
      images: string[];
      videos: ProductVideoItem[];
    } | null;
    compareResult: {
      products: {
        id: string;
        name: string;
        basePrice: number;
        stock: number;
        specs: ProductSpecItem[];
      }[];
    } | null;
    relevantProductIds: string[];
    seenProducts: Map<string, CompactProduct>;
    toolFetchedProductIds: Set<string>;
  }): UiBlock {
    const {
      orderResult,
      cartResult,
      photosResult,
      compareResult,
      relevantProductIds,
      seenProducts,
      toolFetchedProductIds,
    } = args;
    if (orderResult) {
      return {
        type: 'PAYMENT_INSTRUCTIONS',
        cardNumber: orderResult.cardNumber,
        ownerName: orderResult.ownerName,
        amount: orderResult.amount,
      };
    }
    if (cartResult) {
      return {
        type: 'CART_SUMMARY',
        items: cartResult.cart,
        total: cartResult.total,
      };
    }
    if (photosResult) {
      return {
        type: 'PRODUCT_PHOTOS',
        productId: photosResult.productId,
        productName: photosResult.productName,
        images: photosResult.images,
        videos: photosResult.videos,
      };
    }
    if (compareResult) {
      return { type: 'COMPARE_CARD', products: compareResult.products };
    }
    if (relevantProductIds.length > 0) {
      // باگ واقعی زنده (۱۴۰۵/۰۷/۱۹، همون مکانیزم lastShownProducts بالا) — relevantProductIds
      // همیشه در برابر seenProducts resolve می‌شد که همیشه شامل «کاتالوگ اولیه»ی بی‌ربط هم هست؛
      // یعنی حتی بعد از فیکس lastShownProducts (برای نوبت بعد)، خودِ کارت محصول همین نوبت
      // هنوز می‌توانست محصول اشتباه نشان بدهد. فیکس: اگر این نوبت واقعاً یک ابزار جست‌وجو/جزئیات
      // صدا زده شده (یعنی مدل فعالانه دنبال چیز خاصی می‌گشته)، فقط شناسه‌هایی که واقعاً از همان
      // جست‌وجو برگشته‌اند مجازند؛ اگر هیچ ابزاری صدا نزده (یعنی احتمالاً دارد مستقیماً از همان
      // کاتالوگ اولیه جواب می‌دهد، مثل «همه‌ی محصولاتتون رو نشون بدید»)، رفتار قبلی حفظ می‌شود.
      const candidateIds =
        toolFetchedProductIds.size > 0
          ? relevantProductIds.filter((id) => toolFetchedProductIds.has(id))
          : relevantProductIds;
      const matched = candidateIds
        .map((id) => seenProducts.get(id))
        .filter((p): p is CompactProduct => !!p)
        .slice(0, 3);
      if (matched.length > 0) {
        return {
          type: 'PRODUCT_CARD',
          products: matched.map((p) => ({
            id: p.id,
            name: p.name,
            basePrice: p.basePrice,
            stock: displayStock(p),
            images: p.images,
            videos: p.videos,
            weightGrams: p.weightGrams ?? null,
            purityKarat: p.purityKarat ?? null,
            isWeightBasedPricing: p.isWeightBasedPricing ?? false,
            goldPricingSummary: p.goldPricingSummary ?? null,
          })),
        };
      }
    }
    return { type: 'NONE' };
  }

  // آخرین خط دفاع وقتی یک جهش واقعی (افزودن به سبد/ثبت سفارش/پاک‌کردن سبد) قبلاً اتفاق افتاده
  // ولی مدل بعدش نتوانست respond_to_customer را سالم تولید کند — هرگز این حالت را با retry کامل
  // حلقه‌ی ابزار جبران نمی‌کنیم (ریسک جهش دوباره، مثلاً دوبار افزودن به سبد)؛ فقط یک متن امن از
  // روی واقعیت‌های واقعی (caption() همان الگوی قدیمی) می‌سازیم
  private async salvageReplyAfterMutation(
    conversation: ConversationWithStore,
    orderResult: {
      cardNumber: string;
      ownerName: string;
      amount: number;
    } | null,
    cartResult: { cart: CartItem[]; total: number } | null,
  ): Promise<EngineResult> {
    if (orderResult) {
      const uiBlock: UiBlock = {
        type: 'PAYMENT_INSTRUCTIONS',
        cardNumber: orderResult.cardNumber,
        ownerName: orderResult.ownerName,
        amount: orderResult.amount,
      };
      const facts = `سفارش ثبت شد. مبلغ قابل پرداخت ${orderResult.amount} تومان به شماره کارت ${orderResult.cardNumber} به نام ${orderResult.ownerName}. بعد از واریز، عکس رسید را بفرست.`;
      const reply = await this.caption(facts, conversation);
      await this.logReply(conversation, reply, uiBlock);
      return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
    }
    if (cartResult) {
      const uiBlock: UiBlock = {
        type: 'CART_SUMMARY',
        items: cartResult.cart,
        total: cartResult.total,
      };
      const facts = cartResult.cart.length
        ? `سبد فعلی: ${cartResult.cart.map((i) => `${i.name} × ${i.qty}`).join('، ')} — جمع کل ${cartResult.total} تومان`
        : fa.salesAgent.cartEmpty;
      const reply = await this.caption(facts, conversation);
      await this.logReply(conversation, reply, uiBlock);
      return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
    }
    return this.doClarifyUnclear(conversation);
  }

  // docs/DESIGN-structured-product-search-for-chat-agent.md §۲ — جست‌وجوی ساختاریافته روی کل
  // کاتالوگ: ترتیب/شمارش از SQL، قیمت نمایشی از resolveProductPrices (منبع حقیقت)
  private async runStructuredSearch(
    storeId: string,
    spec: FinderSpec,
    warnings: string[],
    profile: StoreSearchProfile,
    rt: AgentTurnRuntime,
    remember: (p: ConsultationProduct) => void,
  ) {
    const run = await this.productFinder.find(storeId, spec, profile);
    const products = run.rows.length
      ? await this.prisma.product.findMany({
          where: { id: { in: run.rows.map((r) => r.productId) }, storeId, ...BUYER_VISIBLE },
          include: PRODUCT_VARIANT_INCLUDE,
        })
      : [];
    await this.resolveProductPrices(storeId, products);
    const byId = new Map(products.map((p) => [p.id, p]));
    const items: ReturnType<typeof buildFinderItem>[] = [];
    for (const row of run.rows) {
      const p = byId.get(row.productId);
      if (!p) continue;
      const variant = row.variantId ? p.variants?.find((v) => v.id === row.variantId) : undefined;
      const tsPrice = variant?.priceOverride ?? p.basePrice;
      if (priceMismatch(row.price, tsPrice)) {
        this.logger.warn(
          `finder price mismatch product=${p.id} variant=${row.variantId ?? '-'} sql=${row.price} ts=${tsPrice}`,
        );
        aceNote('productFinder', `قیمت SQL (${row.price}) با قیمت نمایشی (${tsPrice}) برای «${p.name}» فرق داشت؛ مقدار نمایشی استفاده شد`, 'search_products');
      }
      remember(p);
      items.push(buildFinderItem(row, p, tsPrice, spec));
    }
    if (warnings.length) this.logger.warn(`finder spec warnings store=${storeId}: ${warnings.join(' | ')}`);
    rt.ctx.lastSearch = buildLastSearch(spec, run.totalMatched, items.map((i) => i.id));
    const priceInvolved = spec.minPrice !== undefined || spec.maxPrice !== undefined || spec.sortBy === 'price';
    const hint = run.totalMatched === 0 ? buildZeroHint(spec, profile) : undefined;
    return {
      catalog: run.totalCatalog,
      matched: run.totalMatched,
      applied: appliedOf(spec),
      sorted: sortLabel(spec),
      items,
      ...(priceInvolved && run.unpricedCount > 0 ? { unpriced: run.unpricedCount } : {}),
      ...(hint ? { hint } : {}),
      ...(warnings.length ? { warnings } : {}),
    };
  }

  // docs/PRD-sales-agent-sales-state-machine.md §۱۵.۲ — ساخت ابزارها از callFullAgentTurn بیرون
  // کشیده شد تا مسیر فعلی و مسیر ماشین‌حالت فروش همان ابزارها را بدون کپی استفاده کنند. بدنه‌ی
  // هر ابزار عیناً همان قبلی است؛ فقط متغیرهای closure (ctx/mutationHappened/...) حالا روی rt هستند
  private buildAgentTools<R>(
    conversation: ConversationWithStore,
    rt: AgentTurnRuntime,
    opts: {
      persuasionEnabled: boolean;
      respondToCustomer: R;
      briefOn?: boolean;
      // docs/DESIGN-structured-product-search-for-chat-agent.md §۴.۵ — پروفایل داده‌ی فروشگاه؛
      // نبودنش (تست‌ها) یعنی اسکیمای کامل
      searchProfile?: StoreSearchProfile;
    },
  ) {
    const storeId = conversation.storeId;
    const searchProfile = opts.searchProfile ?? GENERIC_SEARCH_PROFILE;
    const storePersuasionEnabled = opts.persuasionEnabled;

    // ACE-16 — فقط وقتی لایه‌ی productBrief روشن است به ابزارها اضافه می‌شود
    const readProductSectionTool = tool({
      description:
        'متن کامل و عین بخش‌های توضیح یک محصول را با شناسه‌ی بخش (مثل s3) برمی‌گرداند؛ حداکثر ۳ بخش در هر بار. ' +
        'فقط برای بخش‌هایی که در «بخش‌های دیگر توضیح» همان محصول فهرست شده‌اند.',
      inputSchema: z.object({ productId: z.string(), sectionIds: z.array(z.string()).min(1).max(3) }),
      execute: async ({ productId, sectionIds }: { productId: string; sectionIds: string[] }) => {
        const product = await this.prisma.product.findUnique({
          where: { id: productId, ...BUYER_VISIBLE },
          include: { optionTypes: { include: { values: true } } },
        });
        if (!product || product.storeId !== storeId || !product.description) {
          return { error: 'محصولی با این شناسه در این فروشگاه پیدا نشد' };
        }
        const rows = await this.loadUsableBriefs([product]);
        const row = rows.get(product.id);
        if (!row) return { fullDescription: product.description };
        aceNote('productBrief', `مدل بخش‌های ${sectionIds.join('، ')} از توضیح «${product.name}» را با ابزار خواند`, 'read_product_section');
        return { sections: readSections(row, normalizeDescription(product.description), sectionIds) };
      },
    });

    const rememberProduct = (p: ConsultationProduct) => {
      rt.seenProducts.set(p.id, {
        id: p.id,
        name: p.name,
        basePrice: p.basePrice,
        stock: displayStock(p),
        images: p.images,
        description: p.description,
        videos: parseProductVideos(p.videos),
        weightGrams: p.weightGrams,
        purityKarat: p.purityKarat,
        isWeightBasedPricing: p.pricingModel === 'WEIGHT_BASED_FORMULA',
        goldPricingSummary: goldPricingSummaryOf(p),
      });
      rt.toolFetchedProductIds.add(p.id);
    };

    const searchProductsTool = tool({
      description: buildSearchDescription(searchProfile),
      inputSchema: buildSearchInputSchema(searchProfile),
      execute: async (input: Record<string, unknown>) => {
        const { spec, notes } = toFinderSpec(input, searchProfile);
        // §۱۱.۸ — شناسه‌ها در پرامپت نیستند؛ «صفحه‌ی بعد» را سرور از آخرین جست‌وجو پر می‌کند
        if (notes.nextPage) spec.excludeIds = nextPageExcludeIds(rt.ctx.lastSearch);
        // docs/DESIGN-structured-product-search-for-chat-agent.md §۴.۱ — فقط query: رفتار
        // مشاوره‌ای امروز (کد، تطابق متنی روی نام/توضیح، fallback کاتالوگ برای پیام نیازمحور)
        if (spec.query && isQueryOnly(spec)) {
          const results = await this.searchProductsForConsultation(storeId, spec.query);
          for (const p of results) rememberProduct(p);
          return results.map((p) => ({
            id: p.id,
            name: p.name,
            basePrice: p.basePrice,
            inStock: displayStock(p) > 0,
            description: p.description
              ? truncateDescriptionForFacts(
                  p.description,
                  descriptionMaxFor(results.length),
                )
              : null,
            specs: parseProductSpecs(p.specs),
            ...(hasVariantOptions(p)
              ? { options: this.describeVariantOptions(p).trim() }
              : {}),
            ...(goldPricingSummaryOf(p)
              ? { goldPricing: goldPricingSummaryOf(p) }
              : {}),
          }));
        }
        return this.runStructuredSearch(storeId, spec, notes.warnings, searchProfile, rt, rememberProduct);
      },
    });

    const getProductDetailsTool = tool({
      description:
        'جزئیات کامل یک محصول (توضیحات کامل، قیمت، موجودی) را با شناسه‌اش برمی‌گرداند',
      inputSchema: z.object({ productId: z.string() }),
      execute: async ({ productId }: { productId: string }) => {
        const product = await this.prisma.product.findUnique({
          where: { id: productId, ...BUYER_VISIBLE },
          include: PRODUCT_VARIANT_INCLUDE,
        });
        if (!product || product.storeId !== storeId) {
          return { error: 'محصولی با این شناسه در این فروشگاه پیدا نشد' };
        }
        await this.resolveProductPrices(storeId, [product]);
        rt.seenProducts.set(product.id, {
          id: product.id,
          name: product.name,
          basePrice: product.basePrice,
          stock: displayStock(product),
          images: product.images,
          description: product.description,
          videos: parseProductVideos(product.videos),
          weightGrams: product.weightGrams,
          purityKarat: product.purityKarat,
          isWeightBasedPricing: product.pricingModel === 'WEIGHT_BASED_FORMULA',
          goldPricingSummary: goldPricingSummaryOf(product),
        });
        rt.toolFetchedProductIds.add(product.id);
        const persuasionNote = await this.buildPersuasionNote(
          storeId,
          product,
          storePersuasionEnabled,
        );
        return {
          id: product.id,
          name: product.name,
          basePrice: product.basePrice,
          inStock: displayStock(product) > 0,
          description: product.description
            ? truncateDescriptionForFacts(product.description, DESCRIPTION_FACTS_SINGLE_MAX_CHARS)
            : null,
          specs: parseProductSpecs(product.specs),
          ...(hasVariantOptions(product)
            ? { options: this.describeVariantOptions(product).trim() }
            : {}),
          ...(goldPricingSummaryOf(product)
            ? { goldPricing: goldPricingSummaryOf(product) }
            : {}),
          ...(persuasionNote ? { persuasion: persuasionNote.trim() } : {}),
        };
      },
    });

    const updateCartTool = tool({
      description:
        'محصولی را به سبد مشتری اضافه یا از آن حذف می‌کند — تنها راه واقعی تغییر سبد، تغییر فقط در متن کافی نیست',
      inputSchema: z.object({
        productId: z.string(),
        // 0.2 — فقط عدد صحیح ۱..سقف؛ qty منفی/اعشاری مبلغ سفارش را دستکاری می‌کرد
        qty: z.number().int().min(1).max(CART_MAX_QTY_PER_LINE).optional(),
        remove: z.boolean().optional(),
      }),
      execute: async ({
        productId,
        qty,
        remove,
      }: {
        productId: string;
        qty?: number;
        remove?: boolean;
      }) => {
        // سبد بعد از ثبت سفارش/در AWAITING_PAYMENT قفل است؛ مدل همین پیام را به خریدار می‌گوید [R0.5]
        if (await this.isCartLocked(conversation)) {
          return { error: fa.salesAgent.cartLocked };
        }
        const product = await this.prisma.product.findUnique({
          where: { id: productId, ...BUYER_VISIBLE },
          include: PRODUCT_VARIANT_INCLUDE,
        });
        if (!product || product.storeId !== storeId) {
          return { error: 'محصولی با این شناسه در این فروشگاه پیدا نشد' };
        }
        await this.resolveProductPrices(storeId, [product]);
        // docs/PRD-sales-agent-sales-state-machine.md §۲.۲ — محصول دارای سایز/رنگ نباید بدون
        // انتخاب واریانت به سبد برود؛ همان مسیر دکمه‌ی ADD_TO_CART: چیپ‌های انتخاب نمایش داده
        // می‌شود و finalizeVariantSelection بعد از انتخاب کامل خودش به سبد اضافه می‌کند
        if (!remove && hasVariantOptions(product)) {
          rt.flowResult = await this.startVariantSelection(
            conversation,
            rt.ctx,
            product,
            qty ?? 1,
          );
          rt.mutationHappened = true;
          return {
            done: true,
            note: 'انتخاب سایز/رنگ شروع شد؛ دیگر respond_to_customer لازم نیست',
          };
        }
        const mutation = this.computeCartMutation(
          rt.ctx.cart,
          product,
          null,
          qty ?? 1,
          !!remove,
        );
        if (!mutation.ok) {
          return { error: 'موجودی این محصول کافی نیست' };
        }
        // بخش ۱.۳/۱.۴ docs/PRD-full-agent-engineering-review.md — ترتیب عمداً برعکس شد: قبلاً
        // rt.ctx/rt.mutationHappened قبل از تایید persist ست می‌شدند؛ اگر persistTransition throw
        // می‌کرد (خطای گذرای DB)، SDK خطا را به مدل برمی‌گرداند و مدل می‌توانست دوباره همین ابزار
        // را صدا بزند، این‌بار روی rt.ctx ای که از قبل (بدون persist موفق) تغییر کرده بود — یعنی
        // تعداد می‌توانست دوبرابر شود. حالا دقیقاً مثل cancel_order/request_human_handoff: فقط
        // بعد از موفقیت persist، rt.ctx/مینی‌حالت لوکال آپدیت می‌شوند.
        // فیدبک کاربر ۱۴۰۵/۰۷/۱۶ — همون باگ applyCartUpdate: appliedDiscount نادیده گرفته
        // می‌شد؛ این مسیر هم باید با آن سازگار بماند
        let nextAppliedDiscount = rt.ctx.appliedDiscount;
        if (rt.ctx.appliedDiscount) {
          const discountPreview = await this.previewDiscount(
            storeId,
            mutation.cart,
            rt.ctx.appliedDiscount.code,
          );
          nextAppliedDiscount = discountPreview.valid
            ? {
                id: discountPreview.id,
                code: discountPreview.code,
                amountToman: discountPreview.amountToman,
              }
            : null;
        }
        const nextCtx = {
          ...rt.ctx,
          cart: mutation.cart,
          appliedDiscount: nextAppliedDiscount,
        };
        await this.persistTransition(conversation, 'CART_REVIEW', nextCtx);
        rt.ctx = nextCtx;
        rt.mutationHappened = true;
        await this.resetClarifyAttempts(conversation);
        const rawTotal = this.cartTotal(rt.ctx.cart);
        const total = nextAppliedDiscount
          ? rawTotal - nextAppliedDiscount.amountToman
          : rawTotal;
        rt.cartResult = { cart: rt.ctx.cart, total };
        if (!remove) rt.progressHappened = true;
        return {
          cart: rt.ctx.cart.map((i) => ({
            name: i.name,
            qty: i.qty,
            unitPrice: i.unitPrice,
          })),
          total,
          ...(nextAppliedDiscount
            ? { appliedDiscountCode: nextAppliedDiscount.code }
            : {}),
        };
      },
    });

    const viewCartTool = tool({
      description: 'محتوای فعلی سبد مشتری را برمی‌گرداند',
      inputSchema: z.object({}),
      execute: () => {
        const rawTotal = this.cartTotal(rt.ctx.cart);
        const total = rt.ctx.appliedDiscount
          ? rawTotal - rt.ctx.appliedDiscount.amountToman
          : rawTotal;
        rt.cartResult = { cart: rt.ctx.cart, total };
        return {
          cart: rt.ctx.cart.map((i) => ({
            name: i.name,
            qty: i.qty,
            unitPrice: i.unitPrice,
          })),
          total,
        };
      },
    });

    const applyDiscountTool = tool({
      description:
        'یک کد تخفیف را روی سبد فعلی اعتبارسنجی و اعمال می‌کند (پیش‌نمایش، نه ثبت نهایی)',
      inputSchema: z.object({ code: z.string() }),
      execute: async ({ code }: { code: string }) => {
        const preview = await this.previewDiscount(storeId, rt.ctx.cart, code);
        if (!preview.valid) {
          return {
            error:
              preview.reason === 'MISSING'
                ? 'کد تخفیف نامشخص است'
                : preview.reason === 'MIN_QUANTITY_NOT_MET'
                  ? `این کد تخفیف فقط برای خرید حداقل ${preview.minQuantity} عدد معتبره`
                  : preview.reason === 'PRODUCT_NOT_IN_CART'
                    ? fa.salesAgent.discountCodeProductNotInCart
                    : 'این کد تخفیف معتبر نیست یا منقضی/تمام‌شده',
          };
        }
        // بخش ۱.۳/۱.۴ docs/PRD-full-agent-engineering-review.md — همان ترتیب امن update_cart
        const nextCtx = {
          ...rt.ctx,
          appliedDiscount: {
            id: preview.id,
            code: preview.code,
            amountToman: preview.amountToman,
          },
        };
        await this.persistTransition(conversation, 'CART_REVIEW', nextCtx);
        rt.ctx = nextCtx;
        rt.mutationHappened = true;
        return { amountToman: preview.amountToman, newTotal: preview.newTotal };
      },
    });

    // docs/PRD-sales-agent-sales-state-machine.md §۲.۱ — قبلاً مستقیم executeCreateOrder صدا زده
    // می‌شد و آدرس/هزینه‌ی ارسال/انتخاب روش پرداخت دور زده می‌شد. حالا همان مسیر دکمه‌ی «تایید
    // سبد» (doCreateOrder: آدرس اگر requiresShipping → روش پرداخت → finalize) اجرا می‌شود و
    // نتیجه‌اش از طریق rt.flowResult نوبت را کوتاه می‌کند. از اینجا به بعد rt.orderResult از این ابزار
    // ست نمی‌شود (شاخه‌های rt.orderResult در deriveFullAgentUiBlock/salvageReplyAfterMutation
    // عمداً دست‌نخورده ماندند)
    const createOrderTool = tool({
      description:
        'بعد از تایید صریح مشتری، فلوی ثبت سفارش (آدرس/روش پرداخت/اطلاعات پرداخت) را شروع می‌کند — ' +
        'بعد از صدازدنش دیگر respond_to_customer را صدا نزن.',
      inputSchema: z.object({}),
      execute: async () => {
        if (rt.ctx.cart.length === 0) {
          return { error: 'سبد خالی است، چیزی برای ثبت سفارش نیست' };
        }
        rt.flowResult = await this.doCreateOrder(conversation, rt.ctx);
        rt.mutationHappened = true;
        rt.progressHappened = true;
        return {
          done: true,
          note: 'فلوی ثبت سفارش شروع شد؛ دیگر respond_to_customer لازم نیست',
        };
      },
    });

    // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۶ — فقط وقتی
    // conversation.store.leadCaptureOnly=true در tools زیر جایگزین createOrderTool می‌شود؛ مثل
    // requestHumanHandoffTool، همین rt.handoffResult را ست می‌کند تا همان مسیر کوتاه (بدون نیاز به
    // respond_to_customer) طی شود — هیچ Order ای در کار نیست
    const captureLeadTool = tool({
      description:
        'وقتی مشتری علاقه‌ی واقعی نشان داد، همین‌جا به‌عنوان لید ثبتش کن — این فروشگاه سفارش/پرداخت ندارد. ' +
        'اگر فروشگاه لینک وبسایت دارد، phone را خالی بگذار (فقط اگر مشتری خودش داوطلبانه داد پرش کن)؛ ' +
        'اگر لینک وبسایت ندارد، phone را قبل از صدازدن حتماً از مشتری گرفته باش.',
      inputSchema: z.object({
        phone: z.string().optional(),
        name: z.string().optional(),
        interest: z.string().optional(),
      }),
      execute: async ({ phone, name, interest }) => {
        rt.handoffResult = await this.captureLead(conversation, {
          phone,
          name,
          interest,
        });
        rt.mutationHappened = true;
        // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — قبلاً اینجا ست نمی‌شد، پس openQuestionStreak حتی بعد از ثبت
        // واقعی لید هم فقط افزایش پیدا می‌کرد (چون قبلاً برای leadCaptureOnly اصلاً استفاده
        // نمی‌شد). حالا که leadCaptureNudgeActive از همین شمارنده استفاده می‌کند، باید دقیقاً مثل
        // update_cart (پیشرفت سرور-محور، نه خوداظهاری مدل) با اجرای واقعی این ابزار ریست شود
        rt.progressHappened = true;
        return { done: true };
      },
    });

    const cancelOrderTool = tool({
      description: 'سبد فعلی را کاملاً خالی می‌کند (انصراف مشتری از خرید فعلی)',
      inputSchema: z.object({}),
      execute: async () => {
        if (
          !['GREETING', 'BROWSING', 'CART_REVIEW'].includes(
            conversation.currentState,
          )
        ) {
          return { error: 'در این مرحله چیزی برای لغو نیست' };
        }
        rt.ctx = await this.resetCartState(conversation, rt.ctx);
        rt.mutationHappened = true;
        rt.cartResult = { cart: [], total: 0 };
        return { ok: true };
      },
    });

    // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۱ — قبلاً هیچ
    // ابزاری برای این نبود؛ سیستم‌پرامپت صریحاً سؤال پس از خرید را به request_human_handoff
    // می‌سپرد. Order.conversationId یک‌به‌یک به همین مکالمه وصل است (آخرین/تنها سفارش)
    const checkOrderStatusTool = tool({
      description:
        'آخرین وضعیت سفارشِ همین مکالمه را برمی‌گرداند (ثبت رسید/تاییدشده/آماده‌سازی/ارسال‌شده/رد شده). ' +
        'همیشه قبل از request_human_handoff برای سؤال‌هایی مثل «سفارشم کجاست؟»/«وضعیت سفارش» این را صدا بزن.',
      inputSchema: z.object({}),
      execute: async () => {
        const order = await this.prisma.order.findFirst({
          where: { conversationId: conversation.id },
          orderBy: { createdAt: 'desc' },
        });
        if (!order) return { found: false };
        const statusLabel: Record<string, string> = {
          PENDING_PAYMENT: 'در انتظار پرداخت',
          RECEIPT_SUBMITTED: 'رسید ارسال‌شده، در انتظار تایید فروشنده',
          APPROVED: order.hasFulfillmentDelay
            ? 'تاییدشده، در حال آماده‌سازی'
            : 'تاییدشده',
          REJECTED: 'رسید رد شده',
          SHIPPED: 'ارسال/آماده شده',
          DELIVERED: 'تحویل داده شده',
          CANCELLED: 'لغو شده',
        };
        return {
          found: true,
          orderCode: displayOrderCode(order),
          status: order.status,
          carrier: order.carrier,
          trackingCode: order.trackingCode,
          statusLabel: statusLabel[order.status] ?? order.status,
          createdAt: order.createdAt,
          shippedAt: order.shippedAt,
          stillInProduction:
            order.hasFulfillmentDelay && order.status === 'APPROVED',
        };
      },
    });

    const answerFaqTool = tool({
      description:
        'جواب واقعی یک سؤال (باکس دانش فروشگاه / توضیح محصولات اخیر / پروفایل فروشگاه) را جست‌وجو می‌کند',
      inputSchema: z.object({ question: z.string() }),
      execute: async ({ question }: { question: string }) => {
        // [QA-8] فروشگاه لید: «اطلاعات فروشگاه» (معرفی/ارسال/مرجوعی) همین الان عیناً در پرامپت
        // سیستمِ همین نوبت هست؛ فراخوان LLM جداگانه‌ی tryAnswerFromStoreProfile فقط همان واقعیت‌ها
        // را بازنویسی می‌کرد (یک رفت‌وبرگشت کامل مدل، پشتِ سرِ جست‌وجوی باکس دانش) — حذف می‌شود
        const leadOnly = isNivoLeadStore(conversation.store);
        const found = await this.findFaqAnswer(conversation, rt.ctx, question, {
          skipStoreProfileLlm: leadOnly,
        });
        if (found) return found;
        // PQ-5 — سؤال بی‌جواب مشتری؛ سیگنال کیفیت توضیح همان محصول (بدون schema جدید)
        if (!leadOnly && !conversation.store.isDemo) {
          const productId =
            rt.ctx.anchoredProductId ??
            rt.ctx.lastShownProducts?.[0]?.id ??
            null;
          this.productEvents.log(
            'faq_miss',
            { storeId, conversationId: conversation.id },
            { productId, question: question.trim().slice(0, 200) },
          );
        }
        return leadOnly
          ? {
              matched: false,
              note: 'در باکس دانش جوابی نبود؛ اطلاعات ثابت فروشگاه (معرفی/ارسال/مرجوعی) همین الان در بخش «اطلاعات فروشگاه» پرامپت توست — اگر جواب همان‌جاست همان را بده، وگرنه چیزی اختراع نکن.',
            }
          : { matched: false };
      },
    });

    const requestHumanHandoffTool = tool({
      description:
        'مکالمه را به یک فروشنده‌ی انسانی ارجاع می‌دهد — برای درخواست صریح صحبت با انسان یا مشکلاتی (پرداخت/پس از خرید) که ابزاری برای حلش نداری',
      inputSchema: z.object({ reason: z.string().optional() }),
      execute: async ({ reason }: { reason?: string }) => {
        rt.handoffResult = await this.transitionToHandoff(
          conversation,
          'CUSTOMER_REQUESTED',
          reason,
        );
        rt.mutationHappened = true;
        return { done: true };
      },
    });

    const showProductPhotosTool = tool({
      description:
        'همه‌ی عکس‌های یک محصول را برمی‌گرداند — برای درخواست صریح عکس بیشتر',
      inputSchema: z.object({ productId: z.string() }),
      execute: async ({ productId }: { productId: string }) => {
        const product = await this.prisma.product.findUnique({
          where: { id: productId, ...BUYER_VISIBLE },
        });
        if (
          !product ||
          product.storeId !== storeId ||
          product.images.length === 0
        ) {
          return { error: 'عکسی برای این محصول پیدا نشد' };
        }
        rt.photosResult = {
          productId: product.id,
          productName: product.name,
          images: product.images,
          videos: parseProductVideos(product.videos),
        };
        return { images: product.images };
      },
    });

    // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۶ (فاز ۴.۸، مورد ۴) — وقتی مشتری بین ۲-۳
    // محصول مردد است؛ فقط مشخصات واقعی (قیمت/موجودی/specs) را کنار هم برمی‌گرداند، هیچ ویژگی
    // اختراع نمی‌کند
    const compareProductsTool = tool({
      description:
        'مقایسه‌ی ۲ یا ۳ محصول کنار هم (قیمت/موجودی/مشخصات) — فقط وقتی مشتری صریح بین چند محصول مردد است یا مقایسه خواسته',
      inputSchema: z.object({
        productIds: z.array(z.string()).min(2).max(3),
      }),
      execute: async ({ productIds }: { productIds: string[] }) => {
        const products = await this.prisma.product.findMany({
          where: { id: { in: productIds }, storeId, ...BUYER_VISIBLE },
          include: PRODUCT_VARIANT_INCLUDE,
        });
        await this.resolveProductPrices(storeId, products);
        for (const p of products) {
          rt.seenProducts.set(p.id, {
            id: p.id,
            name: p.name,
            basePrice: p.basePrice,
            stock: displayStock(p),
            images: p.images,
            description: p.description,
            videos: parseProductVideos(p.videos),
            weightGrams: p.weightGrams,
            purityKarat: p.purityKarat,
            isWeightBasedPricing: p.pricingModel === 'WEIGHT_BASED_FORMULA',
            goldPricingSummary: goldPricingSummaryOf(p),
          });
          rt.toolFetchedProductIds.add(p.id);
        }
        rt.compareResult = {
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            basePrice: p.basePrice,
            stock: displayStock(p),
            specs: parseProductSpecs(p.specs),
          })),
        };
        return rt.compareResult;
      },
    });

    // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — جدا از فراخوانی generateText تا guard تناقض‌خودگزارشی بتواند همین
    // ابزارها را برای یک تلاش اصلاحی دوباره استفاده کند؛ حالت بین دو تلاش از طریق rt مشترک است
    return {
      search_products: searchProductsTool,
      get_product_details: getProductDetailsTool,
      update_cart: updateCartTool,
      view_cart: viewCartTool,
      apply_discount: applyDiscountTool,
      ...(isNivoLeadStore(conversation.store)
        ? { capture_lead: captureLeadTool }
        : { create_order: createOrderTool }),
      cancel_order: cancelOrderTool,
      check_order_status: checkOrderStatusTool,
      answer_faq: answerFaqTool,
      request_human_handoff: requestHumanHandoffTool,
      show_product_photos: showProductPhotosTool,
      compare_products: compareProductsTool,
      // نوع tools عمداً با ابزار اختیاری عوض نمی‌شود (استنتاج toolCalls در حلقه‌ی اصلی)
      ...((opts.briefOn ? { read_product_section: readProductSectionTool } : {}) as Record<never, never>),
      respond_to_customer: opts.respondToCustomer,
    };
  }

  // یک تلاش کامل (بدون fallback مدل) — چون ابزارهای این حلقه اثر واقعی روی DB دارند (سبد/
  // سفارش)، runFullAgentTurn پایین فقط وقتی اجازه‌ی retry با مدل دیگر می‌دهد که هنوز هیچ
  // جهشی اتفاق نیفتاده باشد (mutationHappened=false) — وگرنه دوبار افزودن به سبد ممکن بود
  private async callFullAgentTurn(
    conversation: ConversationWithStore,
    customerMessage: string,
    model: string,
    isFallbackAttempt = false,
  ): Promise<{
    engineResult: EngineResult;
    inputTokens: number;
    outputTokens: number;
  }> {
    const storeId = conversation.storeId;

    // [QA-8] دو خواندن مستقل DB (کاتالوگ اولیه، تاریخچه‌ی اخیر) پشت‌سرهم منتظر هم نمی‌مانند
    const [initialProducts, transcript] = await Promise.all([
      this.searchProducts(storeId),
      this.buildRecentTranscript(conversation.id),
    ]);
    const seenProducts = new Map<string, CompactProduct>(
      initialProducts.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          basePrice: p.basePrice,
          stock: displayStock(p),
          images: p.images,
          description: p.description,
          videos: parseProductVideos(p.videos),
          weightGrams: p.weightGrams,
          purityKarat: p.purityKarat,
          isWeightBasedPricing: p.pricingModel === 'WEIGHT_BASED_FORMULA',
          goldPricingSummary: goldPricingSummaryOf(p),
        },
      ]),
    );
    // باگ واقعی زنده (۱۴۰۵/۰۷/۱۹) — عمداً جدا از seenProducts: آن Map همیشه شامل «کاتالوگ اولیه»
    // (۵ محصول با جدیدترین createdAt، بی‌ربط به روند گفتگو) هم هست، پس عضویت در seenProducts
    // کافی نیست تا بفهمیم مدل واقعاً این نوبت رویش جست‌وجو/لوکاپ زده یا نه — دیده شد که مدل گاهی
    // relevantProductIds را به شناسه‌ی محصولاتی که فقط در کاتالوگ اولیه بودند (و اصلاً در متن
    // پاسخش هم نبودند) ست می‌کند. این Set فقط محصولاتی را نگه می‌دارد که همین نوبت واقعاً با
    // search_products/get_product_details صدا زده شده‌اند — تنها شرط قابل‌اعتماد برای این‌که
    // بگوییم مدل واقعاً این نوبت رویش تمرکز داشته
    const toolFetchedProductIds = new Set<string>();
    // docs/PRD-sales-agent-sales-state-machine.md §۱۵.۲ — وضعیت قابل‌تغییر این نوبت؛ ابزارها
    // (buildAgentTools) و بدنه‌ی نوبت هر دو از همین آبجکت می‌خوانند/می‌نویسند
    const rt: AgentTurnRuntime = {
      ctx: this.getContext(conversation),
      mutationHappened: false,
      progressHappened: false,
      handoffResult: null,
      flowResult: null,
      cartResult: null,
      orderResult: null,
      photosResult: null,
      compareResult: null,
      seenProducts,
      toolFetchedProductIds,
    };
    // docs/PRD-sales-agent-persuasion-principles.md بخش ۶.۳ — کلید فروشگاه؛ اگر خاموش باشد صفر
    // کوئری اضافه (نه فقط نادیده‌گرفتن) — نه findUrgentActiveDiscount صدا زده می‌شود نه
    // buildPersuasionNote چیزی برمی‌گرداند
    const storePersuasionEnabled =
      conversation.store.persuasionTechniquesEnabled;
    // فیدبک کاربر ۱۴۰۵/۰۷/۲۰ — فروشگاه‌های leadCaptureOnly عمداً کاتالوگ ندارند (هدفشان
    // فقط جمع‌آوری لید بر اساس brandIntro/باکس دانش است)؛ جمله‌ی «فعلاً هیچ محصولی در فروشگاه
    // نیست» باعث می‌شد مدل عذرخواهی کند و گفت‌وگو را همان‌جا ببندد، به‌جای این‌که طبق معرفی
    // فروشگاه ادامه بدهد
    const briefOn = await aceOn('productBrief');
    const briefs = briefOn ? await this.loadUsableBriefs(initialProducts) : new Map<string, BriefRow>();
    if (briefs.size)
      aceNote('productBrief', `توضیح ${briefs.size} محصول به‌جای متن بریده‌شده، به‌صورت برگه (واقعیت‌ها/قیدها/فهرست بخش‌ها) به مدل داده شد`, 'full_agent');
    const catalogFacts =
      initialProducts.length === 0
        ? isNivoLeadStore(conversation.store)
          ? 'این فروشگاه عمداً هیچ محصولی برای فروش ندارد — کسب‌وکاری است که فقط از طریق گفت‌وگو ' +
            'با مشتری‌ها آشنا می‌شود و لید جمع می‌کند. هیچ‌وقت نگو «محصولی نداریم»؛ طبق معرفی ' +
            'فروشگاه (storeProfile) و باکس دانش زیر به مشتری جواب بده.'
          : 'فعلاً هیچ محصولی در فروشگاه نیست.'
        : `این ${initialProducts.length} محصول جدید فروشگاه است (از ${await this.prisma.product.count({ where: { storeId, ...BUYER_VISIBLE } })} محصول فعال؛ برای مقایسه، رتبه‌بندی یا هر محصول دیگر حتماً search_products را با فیلتر/sortBy مناسب صدا بزن): ${(
            await Promise.all(
              initialProducts.map((p) =>
                this.buildProductFactsLine(
                  storeId,
                  p,
                  storePersuasionEnabled,
                  descriptionMaxFor(initialProducts.length),
                  briefs.get(p.id),
                ),
              ),
            )
          ).join('، ')}`;
    const urgentDiscount = storePersuasionEnabled
      ? await this.findUrgentActiveDiscount(storeId)
      : null;

    // فیدبک کاربر ۱۴۰۵/۰۷/۲۱ — این نادج ذاتاً حول search_products/سبد است (فروشگاه‌های با
    // کاتالوگ واقعی)؛ در leadCaptureOnly هیچ کاتالوگ/سبد واقعی‌ای نیست، پس progressHappened
    // هیچ‌وقت true نمی‌شود و این نادج همیشه زودتر از حد فعال می‌شد — و فشار «دیگه وقت
    // سوال‌پرسیدن تمام شده»ی آن با قانون «اول answer_faq، بعد CTA» تداخل پیدا می‌کرد (دیده‌شده:
    // یک سؤال قیمت واقعی بدون صدازدن answer_faq مستقیم با CTA جواب داده شد)
    const nudgeActive =
      !isNivoLeadStore(conversation.store) &&
      conversation.openQuestionStreak >= OPEN_QUESTION_NUDGE_THRESHOLD;
    // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — جایگزین همان نادج بالا، مخصوص leadCaptureOnly؛ همان شمارنده‌ی
    // openQuestionStreak را دوباره استفاده می‌کند (قبلاً برای این فروشگاه‌ها فقط بی‌مصرف بالا
    // می‌رفت چون progressHappened هیچ‌وقت true نمی‌شد — الان captureLeadTool.execute هم آن را
    // true می‌کند، پس این شمارنده با اجرای واقعی capture_lead ریست می‌شود، نه با خوداظهاری مدل).
    // آستانه پایین‌تر از OPEN_QUESTION_NUDGE_THRESHOLD عمدی است: این فانل کوتاه‌تر از مرور
    // کاتالوگ واقعی است و دیده‌شده مدل بدون این فشار تا بی‌نهایت فقط معرفی را تکرار می‌کند
    const leadCaptureNudgeActive =
      isNivoLeadStore(conversation.store) &&
      conversation.openQuestionStreak >= LEAD_CAPTURE_NUDGE_THRESHOLD;

    // بدون execute — دقیقاً مثل respond_to_customer در callAgentCaptionWithRelevance (Track B)،
    // حلقه‌ی چندمرحله‌ای SDK بعد از این فراخوان خودش متوقف می‌شود
    //
    // docs/PRD-sales-agent-persuasion-principles.md بخش ۸ — دو فیلد خوداظهاری متقاعدسازی فقط
    // وقتی storePersuasionEnabled باشد به schema اضافه می‌شوند؛ تست زنده نشان داد وقتی این فیلدها
    // همیشه اجباری بمانند ولی PERSUASION_INSTRUCTION (تعریف ۶ اصل) اصلاً در پرامپت نیست، مدل
    // مجبور به حدس‌زدن کورکورانه می‌شود و برچسب‌های غلط/بی‌ربط (مثلاً AUTHORITY بدون هیچ ادعای
    // واقعی) می‌سازد — پس وقتی خاموش است، این فیلدها اصلاً در schema نیستند، نه فقط optional
    const respondBaseShape = {
      text: z.string().describe('متن فارسی کوتاه (حداکثر ۲-۳ جمله) برای مشتری'),
      quickReplies: z
        .array(z.string())
        .max(3)
        .optional()
        .describe('حداکثر ۳ پیشنهاد کوتاه برای قدم بعد خریدار؛ تپ یعنی همان متن ارسال شود'),
      relevantProductIds: z
        .array(z.string())
        .describe(
          'شناسه‌ی محصول(های) واقعاً مرتبط برای نمایش کارت — اگر موضوعی ندارد خالی بگذار',
        ),
      // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — برخلاف persuasionShape/leadFunnelStageShape پایین، این برای
      // هر دو نوع فروشگاه (leadCaptureOnly و کاتالوگ واقعی) همیشه اجباری است؛ دقیقاً همان الگوی
      // خودگزارش‌دهی leadFunnelStage (بدون کال جدای LLM) ولی تعمیم‌یافته — نوبت بعد به‌عنوان
      // «آخرین تحلیل» در پرامپت (rt.ctx.customerState) و چند دستورالعمل استراتژی مصرف می‌شود
      customerState: z
        .object({
          pain: z
            .string()
            .nullable()
            .describe(
              'درد/نیاز واقعی مشتری که تا همین پاسخ فهمیدی، کوتاه و مشخص — اگر هنوز معلوم نیست null',
            ),
          painSolvable: z
            .enum(['UNKNOWN', 'YES', 'PARTIAL', 'NO'])
            .describe(
              'آیا همین فروشگاه/نیوو واقعاً می‌تواند این درد را حل کند — UNKNOWN فقط وقتی pain هنوز null است',
            ),
          empathyShown: z
            .boolean()
            .describe(
              'آیا در متن همین پاسخ واقعاً با درد/نگرانی مشتری همدلی کردی (نه فقط رفتی سراغ ویژگی‌ها/قیمت)',
            ),
          attentionCaptured: z
            .boolean()
            .describe(
              'آیا مشتری الان واقعاً درگیر گفتگوست — نه جواب‌های کوتاه/سرد/تک‌کلمه‌ای/بی‌حوصله',
            ),
          stage: z
            .enum([
              'DISCOVERY',
              'PAIN_IDENTIFIED',
              'PITCHED',
              'OBJECTION',
              'READY',
              'STALLED',
              'LOST',
            ])
            .describe(
              'DISCOVERY=هنوز درد/نیاز معلوم نیست، PAIN_IDENTIFIED=درد مشخص شد ولی هنوز راه‌حل ' +
                'پرزنت نشده، PITCHED=راه‌حل/محصول مشخص معرفی شد، OBJECTION=تردید/اعتراض مطرح کرد، ' +
                'READY=علاقه‌ی روشن نشان داد و آماده‌ی اقدام (خرید یا ثبت لید) است، STALLED=چند ' +
                'نوبت است بدون پیشرفت واقعی فقط سؤال‌های کلی رد و بدل می‌شود، LOST=بی‌علاقه یا ' +
                'پیامش کلاً بی‌ربط است',
            ),
        })
        .describe(
          'تحلیل خودت از وضعیت فعلی مشتری بعد از همین پاسخ — برای ثبت داخلی/استراتژی نوبت بعد، صادقانه، هرگز چیزی که مشتری ببیند نیست',
        ),
    };
    // فیدبک کاربر ۱۴۰۵/۰۷/۲۰ — خوداظهاری قیف لید، فقط برای فروشگاه‌های leadCaptureOnly؛
    // LEAD_CAPTURED عمداً اینجا نیست چون آن را فقط سرور، هم‌زمان با اجرای واقعی capture_lead،
    // ست می‌کند (همون الگوی rt.progressHappened/openQuestionStreak پایین‌تر: پیشرفت سرور-محور،
    // نه خوداظهاری مدل) — نگاه کن به schema.prisma برای توضیح کامل هر مقدار
    const leadFunnelStageShape = {
      leadFunnelStage: z
        .enum([
          'NEW',
          'DISCOVERING_NEED',
          'PITCHED',
          'OBJECTION_RAISED',
          'READY_TO_CAPTURE',
          'NOT_RELEVANT',
        ])
        .describe(
          'مرحله‌ی فعلی مخاطب در قیف جذب لید، بعد از همین پاسخ: NEW=هنوز نیازش معلوم نشده، ' +
            'DISCOVERING_NEED=داری نوع کسب‌وکار/دردسرش را می‌پرسی، PITCHED=راه‌حل مشخص نیوو را ' +
            'معرفی کردی، OBJECTION_RAISED=تردید/اعتراض مطرح کرد، READY_TO_CAPTURE=علاقه‌ی روشن ' +
            'نشان داد و داری شماره می‌گیری، NOT_RELEVANT=پیامش کلاً بی‌ربط به کسب‌وکار نیوو بود',
        ),
    };
    const respondToCustomer = tool({
      description:
        'پاسخ نهایی به مشتری را اعلام می‌کند — دقیقاً یک‌بار، به‌عنوان آخرین قدم (مگر وقتی request_human_handoff زده‌ای)',
      inputSchema:
        storePersuasionEnabled && isNivoLeadStore(conversation.store)
          ? z.object({
              ...respondBaseShape,
              ...persuasionShape,
              ...leadFunnelStageShape,
            })
          : storePersuasionEnabled
            ? z.object({ ...respondBaseShape, ...persuasionShape })
            : isNivoLeadStore(conversation.store)
              ? z.object({ ...respondBaseShape, ...leadFunnelStageShape })
              : z.object({ ...respondBaseShape }),
    });

    // docs/PRD-full-agent-engineering-review.md بخش ۵ — قبلاً factsOrPrompt لاگ‌شده در AI_TRACE
    // برای FULL_AGENT فقط دوباره‌ی customerMessage بود (برچسب «نمایش کامل prompt/facts» در ادمین
    // گمراه‌کننده بود)؛ حالا متن واقعی پرامپت سیستم همین‌جا یک‌بار ساخته و هم به generateText هم
    // به logReply پاس داده می‌شود
    // ACE-2 — فقط موتور بهینه با لایه‌ی promptCache؛ پایدار همان تابع قدیمی را صدا می‌زند
    const promptCacheOn = await aceActive('promptCache');
    if (promptCacheOn)
      aceNote('promptCache', 'prompt با ساختار قابل‌کش (بخش ثابت جدا از بخش متغیر) ساخته شد تا provider بخش ثابت را ارزان‌تر حساب کند', 'full_agent');
    const useLeanPrompt = promptCacheOn || briefs.size > 0;
    const buildPrompt = useLeanPrompt
      ? (...a: Parameters<typeof this.buildFullAgentSystemPromptLean>) =>
          this.buildFullAgentSystemPromptLean(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], briefs.size > 0)
      : this.buildFullAgentSystemPrompt.bind(this);
    const systemPrompt = await buildPrompt(
      conversation,
      rt.ctx,
      catalogFacts,
      transcript,
      nudgeActive,
      storePersuasionEnabled,
      urgentDiscount,
      isNivoLeadStore(conversation.store),
      leadCaptureNudgeActive,
    );

    // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — جدا شده از فراخوانی generateText پایین تا guard تناقض‌خودگزارشی
    // (پایین‌تر، بعد از finalCall اول) بتواند دقیقاً همان ابزارها را بدون تکرار برای یک تلاش
    // اصلاحی دوباره استفاده کند؛ closureهای این ابزارها (rt.mutationHappened/rt.handoffResult/...)
    // مشترکند، پس حالت بین دو تلاش درست منتقل می‌شود
    const tools = this.buildAgentTools(conversation, rt, {
      persuasionEnabled: storePersuasionEnabled,
      respondToCustomer,
      briefOn: briefs.size > 0,
      searchProfile: await this.productFinder.getProfile(storeId, conversation.store.category),
    });

    // ACE-6 — بودجه‌ی step فقط در موتور بهینه با لایه‌ی loopDiet
    const dietArgs = ((await aceActive('loopDiet'))
      ? { prepareStep: loopDietPrepareStep() }
      : {}) as Record<string, never>;
    let result;
    try {
      setCallSite('main_loop');
      result = await generateShopTurn({
        maxRetries: LLM_MAX_RETRIES,
        model: this.aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(model),
        tools,
        // docs/PRD-sales-agent-tool-calling-architecture.md بخش ۲.۳ — سقف هزینه‌ی فروشنده:
        // تعداد قدم ابزار در هر نوبت محدود است، نه بی‌نهایت (Track B مشابه از ۴ استفاده می‌کند؛
        // اینجا چون کل مکالمه‌ست نه فقط doBrowse، کمی بیشتر لازم است)
        stopWhen: stepCountIs(6),
        ...dietArgs,
        system: systemPrompt,
        prompt: customerMessage,
        temperature: 0.3,
      });
    } catch (err) {
      // بخش ۱.۱/۱.۴ docs/PRD-full-agent-engineering-review.md — یافته‌ی بحرانی: قبلاً این
      // generateText هیچ try/catch نداشت. اگر قدم اول همین نوبت یک جهش واقعی را با موفقیت persist
      // می‌کرد (مثلاً create_order/update_cart) ولی قدم دوم به بعد (rate limit، تایم‌اوت، ۵xx بعد
      // از تمام‌شدن retry داخلی SDK) throw می‌کرد، این throw مستقیم از اینجا خارج می‌شد، از کنار
      // چک rt.mutationHappened پایین رد می‌شد (چون اصلاً به آن خط نمی‌رسید)، و به catch خالی
      // runFullAgentTurn می‌رسید — جایی که اصلاً خبر نداشت جهشی رخ داده. نتیجه: یا retry کامل حلقه
      // با مدل دیگر (ریسک دوبار افزودن به سبد/دوبار سفارش)، یا یک پیام عمومی «متوجه نشدم» بدون
      // هیچ اشاره‌ای به جهشی که واقعاً در DB ثبت شده بود. حالا دقیقاً همان مسیر salvage که برای
      // نبودن respond_to_customer طراحی شده بود، برای این throw هم صدا زده می‌شود — بدون رسیدن به
      // catch بیرونی runFullAgentTurn و بدون retry کامل حلقه.
      const caughtShortCircuit = rt.handoffResult ?? rt.flowResult;
      if (caughtShortCircuit) {
        return {
          engineResult: caughtShortCircuit,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      if (rt.mutationHappened) {
        const engineResult = await this.salvageReplyAfterMutation(
          conversation,
          rt.orderResult,
          rt.cartResult,
        );
        return {
          engineResult,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      throw err;
    }

    const shortCircuit = rt.handoffResult ?? rt.flowResult;
    if (shortCircuit) {
      return {
        engineResult: shortCircuit,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      };
    }

    type RespondToCustomerCall = {
      input: {
        text: string;
        quickReplies?: string[];
        relevantProductIds: string[];
        persuasionTechniquesUsed?: PersuasionTechnique[];
        usedGeneralKnowledge?: boolean;
        leadFunnelStage?: Exclude<LeadFunnelStage, 'LEAD_CAPTURED'>;
        customerState: CustomerState;
      };
    };
    let finalCall = result.toolCalls.find(
      (c) => c.toolName === 'respond_to_customer',
    ) as RespondToCustomerCall | undefined;

    if (!finalCall) {
      if (rt.mutationHappened) {
        const engineResult = await this.salvageReplyAfterMutation(
          conversation,
          rt.orderResult,
          rt.cartResult,
        );
        return {
          engineResult,
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        };
      }
      throw new Error(
        'FULL_AGENT did not call respond_to_customer within step limit',
      );
    }

    // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ («دیگه رد خور نداشته باشه») — گارد قطعی روی دو تناقض خودگزارشی
    // پرریسک CustomerState: (۱) مدل گفته مشتری READY است ولی هیچ اقدام واقعی (capture_lead/
    // گرفتن شماره) نکرده، (۲) مدل گفته این درد قابل‌حل نیست ولی هم‌زمان دارد پرزنت/فروش می‌کند.
    // قبلاً این‌ها (مثل suspiciousPriceClaims پایین‌تر) فقط لاگ می‌شدند، هیچ‌وقت خروجی واقعی را
    // عوض نمی‌کردند. فقط وقتی safe است یک‌بار retry می‌کنیم: اگر این تلاش قبلاً یک جهش واقعی ثبت
    // کرده (rt.mutationHappened)، دست به regenerate نمی‌زنیم — دقیقاً همان قاعده‌ای که catch اصلی
    // بالاتر هم رعایت می‌کند (ریسک دوبار افزودن به سبد/دوبار capture). اگر retry چیزی معتبر
    // تولید نکرد (خطا یا بازهم بدون respond_to_customer)، پاسخ اول (هرچند ناقص) را نگه می‌داریم —
    // یک retry ناموفق هرگز نباید یک پاسخ موجود را از بین ببرد.
    let usedInputTokens = result.usage.inputTokens ?? 0;
    let usedOutputTokens = result.usage.outputTokens ?? 0;
    // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — برای AI_TRACE ادمین (logReply پایین‌تر)؛ null یعنی هیچ تناقضی
    // تشخیص داده نشد یا (مثل suspiciousPriceClaims) پیش‌تر هم مشتبه بود ولی rt.mutationHappened
    // اجازه‌ی retry نداد
    let correctiveRetryReason:
      'READY_WITHOUT_ACTION' | 'PAIN_NOT_SOLVABLE_CONTRADICTION' | null = null;
    const firstAttemptState = finalCall.input.customerState;
    const readyWithoutAction =
      isNivoLeadStore(conversation.store) && firstAttemptState.stage === 'READY';
    const painNotSolvableContradiction =
      firstAttemptState.painSolvable === 'NO' &&
      (firstAttemptState.stage === 'PITCHED' ||
        firstAttemptState.stage === 'READY');
    if (readyWithoutAction || painNotSolvableContradiction) {
      const reason = readyWithoutAction
        ? 'READY_WITHOUT_ACTION'
        : 'PAIN_NOT_SOLVABLE_CONTRADICTION';
      correctiveRetryReason = reason;
      if (rt.mutationHappened) {
        // یک جهش واقعی (مثلاً update_cart) همین تلاش ثبت شده — دیگر دست به regenerate نمی‌زنیم
        // (ریسک دوبار افزودن به سبد/دوبار capture)، فقط برای بررسی دستی ادمین لاگ می‌کنیم
        this.logger.warn(
          `FULL_AGENT self-report contradiction (${reason}) but mutation already happened, cannot retry: conversation=${conversation.id}`,
        );
      } else {
        this.logger.warn(
          `FULL_AGENT self-report contradiction (${reason}), retrying once: conversation=${conversation.id}`,
        );
        try {
          setCallSite('main_retry_contradiction');
          const retryResult = await generateShopTurn({
            maxRetries: LLM_MAX_RETRIES,
            model: this.aiProvider.buildClient(undefined, {
              supportsStructuredOutputs: true,
            })(model),
            tools,
            stopWhen: stepCountIs(6),
            ...dietArgs,
            system: `${systemPrompt}\n\n${
              readyWithoutAction
                ? CTA_CORRECTIVE_INSTRUCTION
                : PAIN_NOT_SOLVABLE_CORRECTIVE_INSTRUCTION
            }`,
            prompt: customerMessage,
            temperature: 0.3,
          });
          usedInputTokens += retryResult.usage.inputTokens ?? 0;
          usedOutputTokens += retryResult.usage.outputTokens ?? 0;
          const retryShortCircuit = rt.handoffResult ?? rt.flowResult;
          if (retryShortCircuit) {
            return {
              engineResult: retryShortCircuit,
              inputTokens: usedInputTokens,
              outputTokens: usedOutputTokens,
            };
          }
          const retryFinalCall = retryResult.toolCalls.find(
            (c) => c.toolName === 'respond_to_customer',
          ) as RespondToCustomerCall | undefined;
          if (retryFinalCall) {
            result = retryResult;
            finalCall = retryFinalCall;
          }
        } catch (err) {
          this.logger.error(
            `corrective retry failed, keeping original reply: conversation=${conversation.id}`,
            err as Error,
          );
        }
      }
    }

    // docs/PRD-full-agent-engineering-review.md بخش ۵ — برای AI_TRACE ادمین؛ همه‌ی ابزارهایی
    // که همین نوبت واقعاً صدا زده شدند (respond_to_customer جدا هم به‌عنوان text/relevantProductIds
    // ثبت می‌شود، پس اینجا تکرار نمی‌شود) — نشان می‌دهد مدل واقعاً جست‌وجو کرده یا از حافظه جواب داده
    const toolsCalled = result.toolCalls
      .filter((c) => c.toolName !== 'respond_to_customer')
      .map((c) => ({ name: c.toolName, args: c.input }));

    let text = finalCall.input.text.trim();
    const relevantProductIds = finalCall.input.relevantProductIds ?? [];

    // بخش ۴/۱۱ docs/PRD-full-agent-engineering-review.md — جمع تمام مبلغ‌های واقعی این نوبت
    // (قیمت محصولات دیده‌شده، جمع/تک‌تک آیتم‌های سبد، مبلغ سفارش، مبلغ تخفیف، اعداد خود پرامپت)
    const allowedAmounts = () => {
      const known = new Set<number>(extractNumbers(systemPrompt));
      for (const p of rt.seenProducts.values()) known.add(p.basePrice);
      for (const item of rt.ctx.cart) {
        known.add(item.unitPrice);
        known.add(item.unitPrice * item.qty);
      }
      known.add(this.cartTotal(rt.ctx.cart));
      // نکته‌ی TS: rt.cartResult/rt.orderResult فقط داخل closure ابزارها reassign می‌شوند
      const cartResultTotal = rt.cartResult?.total;
      if (cartResultTotal !== undefined) known.add(cartResultTotal);
      const orderResultAmount = rt.orderResult?.amount;
      if (orderResultAmount !== undefined) known.add(orderResultAmount);
      if (rt.ctx.appliedDiscount) known.add(rt.ctx.appliedDiscount.amountToman);
      return known;
    };
    let priceRetries = 0;
    let suspiciousPriceClaims = findSuspiciousPriceClaims(text, allowedAmounts());
    if (suspiciousPriceClaims.length && !rt.mutationHappened) {
      priceRetries = 1;
      this.logger.warn(
        `FULL_AGENT price guard retry: amounts=[${suspiciousPriceClaims.join(', ')}] conversation=${conversation.id}`,
      );
      try {
        setCallSite('main_retry_price');
        const retryResult = await generateShopTurn({
          maxRetries: LLM_MAX_RETRIES,
          model: this.aiProvider.buildClient(undefined, {
            supportsStructuredOutputs: true,
          })(model),
          tools,
          stopWhen: stepCountIs(6),
          ...dietArgs,
          system: `${systemPrompt}\n\n${buildCorrectiveInstruction([
            { code: 'SUSPICIOUS_PRICE', amounts: suspiciousPriceClaims },
          ])}`,
          prompt: customerMessage,
          temperature: 0.3,
        });
        usedInputTokens += retryResult.usage.inputTokens ?? 0;
        usedOutputTokens += retryResult.usage.outputTokens ?? 0;
        const retryShortCircuit = rt.handoffResult ?? rt.flowResult;
        if (retryShortCircuit) {
          return {
            engineResult: retryShortCircuit,
            inputTokens: usedInputTokens,
            outputTokens: usedOutputTokens,
          };
        }
        const retryFinalCall = retryResult.toolCalls.find(
          (c) => c.toolName === 'respond_to_customer',
        ) as RespondToCustomerCall | undefined;
        if (retryFinalCall) {
          result = retryResult;
          finalCall = retryFinalCall;
          text = finalCall.input.text.trim();
          suspiciousPriceClaims = findSuspiciousPriceClaims(text, allowedAmounts());
        }
      } catch (err) {
        this.logger.error(
          `price guard retry failed, stripping instead: conversation=${conversation.id}`,
          err as Error,
        );
      }
    }
    // هنوز مبلغ غیرمجاز مانده (یا retry ممکن نبود) ← جمله‌ی حاوی مبلغ حذف + «قیمت دقیق روی کارت»
    text = await this.applyPriceGuard(conversation, text, allowedAmounts(), priceRetries);
    // ACE-10/12 — فقط shadow: جواب قطعی کاندید ساخته و برای judge ثبت می‌شود؛ جواب واقعی دست‌نخورده
    void this.recordFastAnswerShadow(conversation, customerMessage, text, rt, initialProducts).catch(() => undefined);

    const uiBlock = this.deriveFullAgentUiBlock({
      orderResult: rt.orderResult,
      cartResult: rt.cartResult,
      photosResult: rt.photosResult,
      compareResult: rt.compareResult,
      relevantProductIds,
      seenProducts: rt.seenProducts,
      toolFetchedProductIds: rt.toolFetchedProductIds,
    });

    // باگ واقعی زنده (۱۴۰۵/۰۷/۱۹): FULL_AGENT هیچ‌وقت rt.ctx.lastShownProducts را نمی‌نوشت (برخلاف
    // مسیر قدیمی RULE_BASED که همین فیلد را دقیقاً برای همین مشکل دارد) — یعنی «کاتالوگ اولیه»ی
    // هر نوبت (۵ محصول با جدیدترین createdAt، کاملاً بی‌ربط به روند گفتگو) تنها منبع ساختاریافته‌ی
    // باقی‌مانده بود. وقتی مشتری با یک پیام مبهم («کدوم بهتره؟») بدون اسم محصول ادامه می‌داد، مدل
    // به‌جای کندوکاو در متن خام تاریخچه، به همین کاتالوگ بی‌ربط برمی‌گشت — دیده‌شده زنده: مشتری
    // داشت بین دو غذای سگ مقایسه می‌کرد، مدل ناگهان رفت سراغ دان پرنده.
    //
    // فیکس اول (ناکافی، دیده شد با تست زنده): صرفاً فیلتر با rt.seenProducts کافی نیست، چون
    // rt.seenProducts همیشه شامل همان کاتالوگ اولیه‌ی بی‌ربط هم هست — تست زنده نشان داد مدل گاهی
    // relevantProductIds را به شناسه‌ی محصولی می‌دهد که اصلاً در متن پاسخش نیامده، فقط چون در
    // کاتالوگ اولیه بوده. فیکس نهایی: فقط محصولاتی که همین نوبت واقعاً با search_products/
    // get_product_details صدا زده شده‌اند (rt.toolFetchedProductIds) واجد شرایط lastShownProducts اند.
    const lastShownProducts = relevantProductIds
      .filter((id) => rt.toolFetchedProductIds.has(id))
      .map((id) => rt.seenProducts.get(id))
      .filter((p): p is CompactProduct => !!p)
      .map((p) => ({ id: p.id, name: p.name }));

    // docs/PRD-sales-agent-tool-calling-architecture.md بخش ۴.۱/۴.۲ — سرور-محور، نه خوداظهاری
    // مدل: فقط update_cart(موفق،remove=false)/create_order موفق «پیشرفت» حساب می‌شود
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: {
        ...(rt.progressHappened
          ? { openQuestionStreak: 0 }
          : { openQuestionStreak: { increment: 1 } }),
        // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — قبلاً contextData فقط وقتی lastShownProducts غیرخالی بود
        // نوشته می‌شد؛ چون customerState حالا اجباری و هر نوبت موجود است (نه فقط وقتی محصولی
        // دیده شده)، این write باید همیشه انجام شود — ولی lastShownProducts قبلی را فقط وقتی
        // این نوبت واقعاً چیزی نشان داده شده جایگزین می‌کنیم (همان رفتار قبلی، تا ارجاع‌های
        // ترتیبی مشتری یک نوبت بعد هم کار کند)
        contextData: {
          ...rt.ctx,
          ...(lastShownProducts.length ? { lastShownProducts } : {}),
          customerState: finalCall.input.customerState,
        },
        ...(finalCall.input.leadFunnelStage
          ? { leadFunnelStage: finalCall.input.leadFunnelStage }
          : {}),
      },
    });

    await this.logReply(conversation, text, uiBlock, undefined, {
      intent: 'FULL_AGENT',
      handler: 'runFullAgentTurn',
      factsOrPrompt: systemPrompt,
      model,
      ...(finalCall.input.persuasionTechniquesUsed?.length
        ? { persuasionTechniquesUsed: finalCall.input.persuasionTechniquesUsed }
        : {}),
      ...(finalCall.input.usedGeneralKnowledge
        ? { usedGeneralKnowledge: true }
        : {}),
      ...(finalCall.input.leadFunnelStage
        ? { leadFunnelStage: finalCall.input.leadFunnelStage }
        : {}),
      customerState: finalCall.input.customerState,
      relevantProductIdsRaw: relevantProductIds,
      lastShownProducts,
      toolsCalled,
      initialCatalogProductIds: initialProducts.map((p) => p.id),
      stepsUsed: result.steps.length,
      mutationHappened: rt.mutationHappened,
      progressHappened: rt.progressHappened,
      isFallbackAttempt,
      ...(suspiciousPriceClaims.length ? { suspiciousPriceClaims } : {}),
      ...(correctiveRetryReason ? { correctiveRetryReason } : {}),
    });

    const finalQuickReplies = [...new Set((finalCall.input.quickReplies ?? []).map((q) => q.trim()).filter((q) => q.length > 0 && q.length <= 48))].slice(0, 3);
    await this.maybeStoreSemantic(conversation, customerMessage, text, rt, toolsCalled.map((t) => t.name), uiBlock.type, finalQuickReplies, initialProducts);

    return {
      engineResult: {
        reply: text,
        uiBlocks: [uiBlock],
        state: conversation.currentState,
        quickReplies: finalQuickReplies,
      },
      inputTokens: usedInputTokens,
      outputTokens: usedOutputTokens,
    };
  }

  // ورودی واحد از handleMessage — همون fallback دومرحله‌ای بقیه‌ی فایل (مدل A/B → defaultModel)،
  // با یک تفاوت مهم: چون ابزارهای بالا اثر واقعی DB دارند، retry با مدل دیگر فقط وقتی اجازه داده
  // می‌شود که callFullAgentTurn هنوز هیچ جهشی ثبت نکرده باشد (خودش این را با throw/no-throw
  // مدیریت می‌کند — بعد از جهش هرگز throw نمی‌کند، فقط salvage امن برمی‌گرداند)
  private async runFullAgentTurn(
    conversation: ConversationWithStore,
    text: string,
  ): Promise<EngineResult> {
    const fast = await this.tryServeFastAnswer(conversation, text);
    if (fast) return fast;
    // docs/PRD-sales-agent-sales-state-machine.md §۱۵.۳ — با فلگ خاموش (پیش‌فرض) دقیقاً همان
    // مسیر قبلی؛ ادراک+تصمیم فقط یک‌بار قبل از زنجیره‌ی fallback مدل انجام می‌شود
    let turnFn = (model: string, isFallback: boolean) =>
      this.callFullAgentTurn(conversation, text, model, isFallback);
    const cfg = await getSalesAgentGlobalConfig(this.prisma);
    if (cfg.salesStageMachineEnabled) {
      let prepared: PreparedSalesTurn | null = null;
      try {
        prepared = await this.prepareSalesTurn(conversation, text);
      } catch (err) {
        this.logger.error(
          `prepareSalesTurn failed, falling back to legacy FULL_AGENT: conversation=${conversation.id}`,
          err as Error,
        );
      }
      if (prepared) {
        if (prepared.decision.shortCircuit) {
          return this.runSalesShortCircuit(conversation, prepared);
        }
        const ready = prepared;
        turnFn = (model, isFallback) =>
          this.callSalesTurn(conversation, text, model, ready, isFallback);
      }
    }
    const primaryModel = resolveModel(conversation.abVariant);
    const started = Date.now();
    try {
      const { engineResult, inputTokens, outputTokens } = await turnFn(
        primaryModel,
        false,
      );
      await this.logAiCall(
        conversation,
        'AGENT_CAPTION',
        true,
        Date.now() - started,
      );
      await this.logTextCreditUsage(
        conversation,
        primaryModel,
        inputTokens,
        outputTokens,
      );
      return engineResult;
    } catch (err) {
      this.logger.error(
        `runFullAgentTurn failed (model=${primaryModel}, conversation=${conversation.id})`,
        err as Error,
      );
      await this.logAiCall(
        conversation,
        'AGENT_CAPTION',
        false,
        Date.now() - started,
      );
      if (primaryModel === defaultModel()) {
        return this.doClarifyUnclear(conversation);
      }
      const fallbackStarted = Date.now();
      try {
        const { engineResult, inputTokens, outputTokens } = await turnFn(
          defaultModel(),
          true,
        );
        await this.logAiCall(
          conversation,
          'AGENT_CAPTION',
          true,
          Date.now() - fallbackStarted,
        );
        await this.logTextCreditUsage(
          conversation,
          defaultModel(),
          inputTokens,
          outputTokens,
        );
        return engineResult;
      } catch (fallbackErr) {
        this.logger.error(
          `runFullAgentTurn fallback failed (model=${defaultModel()}, conversation=${conversation.id})`,
          fallbackErr as Error,
        );
        await this.logAiCall(
          conversation,
          'AGENT_CAPTION',
          false,
          Date.now() - fallbackStarted,
        );
        const chained = await this.tryModelFallbackChain(
          conversation,
          'AGENT_CAPTION',
          'runFullAgentTurn',
          (model) =>
            turnFn(model, true).then(
              ({ engineResult, inputTokens, outputTokens }) => ({
                result: engineResult,
                inputTokens,
                outputTokens,
              }),
            ),
        );
        return chained ?? this.doClarifyUnclear(conversation);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────
  // docs/PRD-sales-agent-sales-state-machine.md §۴/§۱۵.۳ — مسیر ماشین‌حالت فروش. فقط وقتی
  // SalesAgentGlobalConfig.salesStageMachineEnabled=true اجرا می‌شود (runFullAgentTurn)؛ با
  // فلگ خاموش هیچ‌کدام از متدهای این بخش صدا زده نمی‌شوند
  // ───────────────────────────────────────────────────────────────────────────────────────

  // ۱۲ رویداد آخر چت (بدون پیام همین نوبت که handleMessage همین الان ثبتش کرده)، قدیمی → جدید
  private async fetchChatHistory(
    conversationId: string,
    take: number,
  ): Promise<HistoryEntry[]> {
    const events = await this.prisma.conversationEvent.findMany({
      where: {
        conversationId,
        type: { in: ['CUSTOMER_MESSAGE', 'AGENT_REPLY'] },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });
    return events
      .slice(1)
      .reverse()
      .map((e) => ({
        role:
          e.type === 'CUSTOMER_MESSAGE'
            ? ('user' as const)
            : ('assistant' as const),
        text: (e.payload as { text?: string } | null)?.text ?? '',
      }))
      .filter((h) => h.text.trim().length > 0);
  }

  private async loadTurnFacts(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
  ): Promise<ServerFacts> {
    const catalogSize = await this.prisma.product.count({
      where: { storeId: conversation.storeId, ...BUYER_VISIBLE },
    });
    return {
      conversationState: conversation.currentState,
      cartItemCount: ctx.cart.length,
      leadCaptureOnly: isNivoLeadStore(conversation.store),
      catalogSize,
      hasWebsiteUrl: !!conversation.store.websiteUrl,
      nowIso: new Date().toISOString(),
    };
  }

  // §۶ — ادراک: مدل ثابت PERCEPTION_MODEL → defaultModel() → زنجیره‌ی fallback؛ اگر همه شکست
  // خوردند perception خنثی (نوبت هرگز به‌خاطر ادراک متوقف نمی‌شود)
  private async perceive(
    conversation: ConversationWithStore,
    mem: SalesMemory,
    ctx: ConversationContext,
    customerMessage: string,
    history: HistoryEntry[],
  ): Promise<{ perception: Perception; failed: boolean }> {
    const store = conversation.store;
    const known = new Set(mem.interests.map((i) => i.id));
    const mentionedProducts = [
      ...mem.interests.map((i) => ({
        id: i.id,
        name: i.name,
        priceToman: i.priceToman,
      })),
      ...(ctx.lastShownProducts ?? [])
        .filter((p) => !known.has(p.id))
        .map((p) => ({ id: p.id, name: p.name, priceToman: 0 })),
    ].slice(-8);
    const lastAgentMessage =
      [...history].reverse().find((h) => h.role === 'assistant')?.text ?? null;
    const system = buildPerceptionPrompt({
      storeContextSummary: [
        store.category && `حوزه‌ی فعالیت: ${store.category}`,
        store.brandIntro,
      ]
        .filter(Boolean)
        .join('. ')
        .slice(0, 300),
      stage: mem.stage,
      lastGoal: mem.lastGoal,
      lastAgentMessage,
      lastAgentQuestion: mem.lastAgentQuestion,
      lastCloseOffer: mem.lastCloseOffer,
      knownSlots: mem.slots,
      mentionedProducts,
      cartSummary: summarizeCart(ctx.cart),
      recentTranscript: history
        .slice(-6)
        .map((h) => `${h.role === 'user' ? 'مشتری' : 'فروشنده'}: ${h.text}`)
        .join('\n'),
    });
    const run = async (model: string) => {
      setCallSite('perception');
      const { object, usage } = await generateObject({
        maxRetries: LLM_MAX_RETRIES,
        model: this.aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(model),
        schema: perceptionSchema,
        system,
        prompt: customerMessage,
        temperature: 0,
        abortSignal: AbortSignal.timeout(PERCEPTION_TIMEOUT_MS),
      });
      return {
        result: object,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
      };
    };
    for (const model of [PERCEPTION_MODEL, defaultModel()]) {
      const started = Date.now();
      try {
        const { result, inputTokens, outputTokens } = await run(model);
        await this.logAiCall(
          conversation,
          'PERCEPTION',
          true,
          Date.now() - started,
        );
        await this.logTextCreditUsage(
          conversation,
          model,
          inputTokens,
          outputTokens,
        );
        return { perception: result, failed: false };
      } catch (err) {
        this.logger.error(
          `perceive failed (model=${model}, conversation=${conversation.id})`,
          err as Error,
        );
        await this.logAiCall(
          conversation,
          'PERCEPTION',
          false,
          Date.now() - started,
        );
      }
    }
    const chained = await this.tryModelFallbackChain(
      conversation,
      'PERCEPTION',
      'perceive',
      run,
    );
    if (chained) return { perception: chained, failed: false };
    return { perception: neutralPerception(mem), failed: true };
  }

  // ادراک + تصمیم (کد قطعی)؛ فقط یک‌بار در هر نوبت — نه در هر تلاش fallback مدل Act
  private async prepareSalesTurn(
    conversation: ConversationWithStore,
    text: string,
  ): Promise<PreparedSalesTurn> {
    const ctx = this.getContext(conversation);
    const memBefore = loadSalesMemory(ctx);
    const factsPromise = this.loadTurnFacts(conversation, ctx);
    const perceivedPromise = this.fetchChatHistory(conversation.id, 12).then(
      async (history) => ({
        history,
        ...(await this.perceive(conversation, memBefore, ctx, text, history)),
      }),
    );
    const [facts, perceived] = await Promise.all([
      factsPromise,
      perceivedPromise,
    ]);
    const perception = sanitizePerception(
      perceived.perception,
      memBefore.interests.map((i) => i.id),
    );
    const mem = applyPerception(memBefore, perception, facts);
    const decision = decideSalesTurn(
      mem,
      memBefore.stage,
      perception,
      facts,
      hoursBetween(memBefore.lastCustomerMessageAt, facts.nowIso),
    );
    if (!perceived.failed && perception.buyerNeeds.length > 0) {
      try {
        await this.recordBuyerNeedCounts(
          conversation.customerId,
          perception.buyerNeeds,
        );
      } catch (err) {
        this.logger.warn(
          `recordBuyerNeedCounts failed: ${(err as Error).message}`,
        );
      }
    }
    return {
      memBefore,
      mem,
      perception,
      perceptionFailed: perceived.failed,
      decision,
      facts,
      history: perceived.history,
    };
  }

  // §۱۵.۴ — حافظه را روی contextData «تازه‌ی DB» merge می‌کند، نه روی ctx ابتدای نوبت؛ فلوهای
  // قطعی (آدرس/واریانت/handoff) خودشان contextData را نوشته‌اند و با ctx کهنه پاک می‌شدند
  private async persistSalesMemory(
    conversation: ConversationWithStore,
    mem: SalesMemory,
    opts: {
      lastShownProducts?: { id: string; name: string }[];
      progressHappened?: boolean;
      lastSearch?: LastSearch | null;
    } = {},
  ): Promise<void> {
    const fresh = await this.prisma.salesConversation.findUnique({
      where: { id: conversation.id },
      select: { contextData: true },
    });
    const base = (fresh?.contextData ?? {}) as Record<string, unknown>;
    const contextData = {
      ...base,
      ...(opts.lastShownProducts?.length
        ? { lastShownProducts: opts.lastShownProducts }
        : {}),
      ...(opts.lastSearch ? { lastSearch: opts.lastSearch } : {}),
      sales: mem,
    };
    const funnel = isNivoLeadStore(conversation.store)
      ? deriveLeadFunnelStage(mem.stage)
      : null;
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: {
        salesStage: mem.stage,
        // سازگاری: شمارنده‌ی قدیمی هنوز برای آنالیتیکس/مسیر قدیمی؛ همان قاعده‌ی فعلی
        ...(opts.progressHappened === undefined
          ? {}
          : opts.progressHappened
            ? { openQuestionStreak: 0 }
            : { openQuestionStreak: { increment: 1 } }),
        contextData: contextData as unknown as Prisma.InputJsonObject,
        ...(funnel ? { leadFunnelStage: funnel } : {}),
      },
    });
    conversation.contextData = contextData;
  }

  // R2 (درخواست انسان) / R4 (اسپم) — بدون فراخوان Act
  private async runSalesShortCircuit(
    conversation: ConversationWithStore,
    prepared: PreparedSalesTurn,
  ): Promise<EngineResult> {
    const { decision, mem, memBefore, perception, perceptionFailed } = prepared;
    const trace: AiTraceData = {
      intent: 'SALES_MACHINE',
      handler: 'runSalesShortCircuit',
      factsOrPrompt: decision.reason,
      model: PERCEPTION_MODEL,
      salesStage: decision.stage,
      prevSalesStage: memBefore.stage,
      turnGoal: decision.goal,
      decisionReason: decision.reason,
      perception,
      perceptionFailed,
    };
    let result: EngineResult;
    if (decision.shortCircuit === 'HUMAN_HANDOFF') {
      result = await this.transitionToHandoff(
        conversation,
        'CUSTOMER_REQUESTED',
      );
      // transitionToHandoff خودش logReply (بدون trace) کرده؛ trace ادراک/تصمیم جدا ثبت می‌شود
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'AI_TRACE',
          payload: {
            intent: trace.intent,
            handler: trace.handler,
            factsOrPrompt: trace.factsOrPrompt,
            model: trace.model,
            salesStage: trace.salesStage,
            prevSalesStage: trace.prevSalesStage,
            turnGoal: trace.turnGoal,
            decisionReason: trace.decisionReason,
            perception: perception,
            ...(perceptionFailed ? { perceptionFailed: true } : {}),
          },
        },
      });
    } else {
      const uiBlock: UiBlock = { type: 'NONE' };
      const reply = fa.salesAgent.spamReply;
      await this.logReply(conversation, reply, uiBlock, undefined, trace);
      result = { reply, uiBlocks: [uiBlock], state: conversation.currentState };
    }
    await this.persistSalesMemory(conversation, mem);
    return result;
  }

  private describeVariantOptions(product: ProductLike): string {
    if (!hasVariantOptions(product)) return '';
    const parts = (product.optionTypes ?? [])
      .map((ot) => {
        const available = ot.values
          .map((v) => v.value)
          .filter((val) =>
            (product.variants ?? []).some(
              (v) =>
                v.stock > 0 &&
                (v.optionValues as Record<string, string> | null)?.[ot.name] ===
                  val,
            ),
          );
        return available.length ? `${ot.name} (${available.join('، ')})` : null;
      })
      .filter(Boolean);
    return parts.length ? ` — گزینه‌ها: ${parts.join('، ')}` : '';
  }

  // §۱۰.۳ — کاندیدهای مرتبط را سرور از قبل پیدا می‌کند (به‌جای ۵ محصول «جدیدترین»)
  private async prefetchCandidates(
    conversation: ConversationWithStore,
    decision: SalesDecision,
    mem: SalesMemory,
    rt: AgentTurnRuntime,
    persuasionEnabled: boolean,
  ): Promise<{ text: string | null; ids: string[] }> {
    const goal = decision.goal;
    const objType = decision.focusObjection?.type;
    const eligible =
      goal === 'RECOMMEND' ||
      goal === 'ALTERNATIVE_CLOSE' ||
      goal === 'TRIAL_CLOSE' ||
      goal === 'EXECUTE_PURCHASE' ||
      (goal === 'HANDLE_OBJECTION' &&
        (objType === 'PRICE' || objType === 'FIT'));
    if (!eligible) return { text: null, ids: [] };
    const storeId = conversation.storeId;
    const rejected = new Set(
      mem.interests.filter((i) => i.signal === 'REJECTED').map((i) => i.id),
    );
    const ids: string[] = [];
    for (const i of [...mem.interests].reverse()) {
      if (i.signal !== 'REJECTED' && !ids.includes(i.id)) ids.push(i.id);
    }
    if (
      goal === 'RECOMMEND' ||
      (goal === 'HANDLE_OBJECTION' && objType === 'PRICE')
    ) {
      const query = [mem.slots.goal, mem.needSummary, ...mem.slots.preferences]
        .filter(Boolean)
        .join(' ');
      if (query) {
        const found = await this.searchProductsForConsultation(storeId, query);
        for (const p of found) {
          if (!rejected.has(p.id) && !ids.includes(p.id)) ids.push(p.id);
        }
      }
    }
    const budget = mem.slots.budgetMaxToman;
    // docs/DESIGN-structured-product-search-for-chat-agent.md §۶.۴ — بودجه‌ی گفته‌شده روی کل
    // کاتالوگ در SQL اعمال می‌شود (نه فقط روی چند محصول جدید). فقط مکمل است: کاندیدهای مرتبط
    // قبلی همچنان اول می‌مانند و «در بودجه نیست» برای آن‌ها حذف نمی‌شود
    if (budget !== null && ids.length < MAX_CANDIDATES) {
      try {
        const profile = await this.productFinder.getProfile(storeId, conversation.store.category);
        const { spec } = toFinderSpec(
          { maxPrice: Math.floor(budget * BUDGET_SOFT_CEILING), sortBy: 'newest', limit: MAX_CANDIDATES },
          profile,
        );
        const extra = await this.productFinder.find(storeId, spec, profile);
        for (const r of extra.rows) {
          if (!rejected.has(r.productId) && !ids.includes(r.productId)) ids.push(r.productId);
        }
      } catch (err) {
        this.logger.warn(`prefetch budget finder failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (ids.length === 0) return { text: null, ids: [] };
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, storeId, ...BUYER_VISIBLE },
      include: PRODUCT_VARIANT_INCLUDE,
    });
    await this.resolveProductPrices(storeId, products);
    const inBudget = (p: { basePrice: number }) =>
      budget === null || p.basePrice <= budget * BUDGET_SOFT_CEILING;
    const order = new Map(ids.map((id, i) => [id, i]));
    // حذف نمی‌شوند: مدل باید بتواند صادقانه بگوید «در بودجه نیست»
    const sorted = [...products]
      .sort(
        (a, b) =>
          Number(!inBudget(a)) - Number(!inBudget(b)) ||
          Number(displayStock(a) <= 0) - Number(displayStock(b) <= 0) ||
          (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      )
      .slice(0, MAX_CANDIDATES);
    for (const p of sorted) {
      rt.seenProducts.set(p.id, {
        id: p.id,
        name: p.name,
        basePrice: p.basePrice,
        stock: displayStock(p),
        images: p.images,
        description: p.description,
        videos: parseProductVideos(p.videos),
        weightGrams: p.weightGrams,
        purityKarat: p.purityKarat,
        isWeightBasedPricing: p.pricingModel === 'WEIGHT_BASED_FORMULA',
        goldPricingSummary: goldPricingSummaryOf(p),
      });
      rt.toolFetchedProductIds.add(p.id);
    }
    const lines = await Promise.all(
      sorted.map(async (p) => {
        const facts = await this.buildProductFactsLine(
          storeId,
          { ...p, stock: displayStock(p) },
          persuasionEnabled,
          // نتیجه‌ی تک‌محصولی (مثلاً «دامن زنانه دارید؟») = تمرکز روی یک محصول؛ جدول سایز نباید بریده شود
          descriptionMaxFor(sorted.length),
        );
        const budgetTag =
          budget === null
            ? ''
            : inBudget(p)
              ? ' [در بودجه]'
              : ' [بالاتر از بودجه]';
        return `${facts}${this.describeVariantOptions(p)}${budgetTag}`;
      }),
    );
    return { text: lines.join('\n'), ids: sorted.map((p) => p.id) };
  }

  // §۹ «پشتیبانی کد» — فقط شواهدی که سرور واقعاً دارد؛ مدل نباید چیزی بیرون از این‌ها ادعا کند
  private async buildObjectionEvidence(
    conversation: ConversationWithStore,
    focusProductId: string | null,
    persuasionEnabled: boolean,
  ): Promise<string | null> {
    const store = conversation.store;
    const lines: string[] = [];
    if (store.returnPolicy)
      lines.push(`شرایط مرجوعی/گارانتی: ${store.returnPolicy}`);
    if (store.shippingInfo) lines.push(`ارسال: ${store.shippingInfo}`);
    const shippingDays = formatShippingDays(
      store.shippingDaysMin,
      store.shippingDaysMax,
    );
    if (shippingDays) lines.push(`زمان ارسال: ${shippingDays}`);
    const shipping = await formatShippingRulesSummary(
      this.prisma,
      conversation.storeId,
    );
    if (shipping) lines.push(`هزینه‌ی ارسال به‌تفکیک استان:\n${shipping}`);
    lines.push(
      `روش‌های پرداخت: کارت‌به‌کارت${this.snapppayAvailable(store) ? '، پرداخت اقساطی اسنپ‌پی: فعال' : ''}`,
    );
    if (focusProductId) {
      const product = await this.prisma.product.findFirst({
        where: { id: focusProductId, storeId: conversation.storeId, ...BUYER_VISIBLE },
        include: PRODUCT_VARIANT_INCLUDE,
      });
      if (product) {
        await this.resolveProductPrices(conversation.storeId, [product]);
        if (product.description) {
          lines.push(
            `توضیحات «${product.name}»: ${truncateDescriptionForFacts(product.description, DESCRIPTION_FACTS_SINGLE_MAX_CHARS)}`,
          );
        }
        const specs = formatSpecsForFacts(parseProductSpecs(product.specs));
        if (specs) lines.push(specs.trim());
        const variantsLine = this.describeVariantOptions(product);
        if (variantsLine) lines.push(`«${product.name}»${variantsLine}`);
        // احترام به تنظیم فروشنده: وقتی persuasion خاموش است هیچ سیگنال اجتماعی/کمبود نمی‌آید
        if (persuasionEnabled) {
          const note = await this.buildPersuasionNote(
            conversation.storeId,
            product,
            true,
          );
          if (note) lines.push(`«${product.name}»:${note}`);
        }
      }
    }
    if (persuasionEnabled) {
      const urgent = await this.findUrgentActiveDiscount(conversation.storeId);
      if (urgent) {
        lines.push(
          `کد تخفیف فعال واقعی: «${urgent.code}» تا ${urgent.expiresAt.toLocaleString('fa-IR')}`,
        );
      }
    }
    return lines.length ? lines.join('\n') : null;
  }

  // یک تلاش کامل Act (بدون fallback مدل) — همان قاعده‌ی callFullAgentTurn: بعد از جهش واقعی
  // هرگز throw/retry نمی‌کند، فقط salvage امن
  private async callSalesTurn(
    conversation: ConversationWithStore,
    customerMessage: string,
    model: string,
    prepared: PreparedSalesTurn,
    isFallbackAttempt = false,
  ): Promise<{
    engineResult: EngineResult;
    inputTokens: number;
    outputTokens: number;
  }> {
    const {
      memBefore,
      mem,
      perception,
      perceptionFailed,
      decision,
      facts,
      history,
    } = prepared;
    const storeId = conversation.storeId;
    const store = conversation.store;
    const persuasionEnabled = store.persuasionTechniquesEnabled;
    const rt: AgentTurnRuntime = {
      ctx: this.getContext(conversation),
      mutationHappened: false,
      progressHappened: false,
      handoffResult: null,
      flowResult: null,
      cartResult: null,
      orderResult: null,
      photosResult: null,
      compareResult: null,
      seenProducts: new Map<string, CompactProduct>(),
      toolFetchedProductIds: new Set<string>(),
    };

    const candidates = await this.prefetchCandidates(
      conversation,
      decision,
      mem,
      rt,
      persuasionEnabled,
    );
    let fallbackCatalogText: string | null = null;
    let initialCatalogProductIds: string[] = [];
    if (
      !candidates.text &&
      !GOALS_WITHOUT_CATALOG_SAMPLE.includes(decision.goal)
    ) {
      const initial = await this.searchProducts(storeId);
      initialCatalogProductIds = initial.map((p) => p.id);
      for (const p of initial) {
        rt.seenProducts.set(p.id, {
          id: p.id,
          name: p.name,
          basePrice: p.basePrice,
          stock: displayStock(p),
          images: p.images,
          description: p.description,
          videos: parseProductVideos(p.videos),
          weightGrams: p.weightGrams,
          purityKarat: p.purityKarat,
          isWeightBasedPricing: p.pricingModel === 'WEIGHT_BASED_FORMULA',
          goldPricingSummary: goldPricingSummaryOf(p),
        });
      }
      if (initial.length) {
        fallbackCatalogText = (
          await Promise.all(
            initial.map((p) =>
              this.buildProductFactsLine(
                storeId,
                { ...p, stock: displayStock(p) },
                persuasionEnabled,
                descriptionMaxFor(initial.length),
              ),
            ),
          )
        ).join('\n');
      }
    }

    const focusProduct = [...mem.interests]
      .filter((i) => i.signal !== 'REJECTED')
      .sort((a, b) => b.lastTurn - a.lastTurn)[0];
    const evidence = EVIDENCE_GOALS.includes(decision.goal)
      ? await this.buildObjectionEvidence(
          conversation,
          focusProduct?.id ?? null,
          persuasionEnabled,
        )
      : null;
    const urgentDiscount = persuasionEnabled
      ? await this.findUrgentActiveDiscount(storeId)
      : null;

    const systemPrompt = buildSalesActSystemPrompt({
      storeName: store.name,
      tone: toneForCategory(store.category),
      storeProfile: await this.buildStoreProfileText(conversation),
      paymentMethodsLine: `روش‌های پرداخت: کارت‌به‌کارت${this.snapppayAvailable(store) ? '، اسنپ‌پی (۴ قسط)' : ''}`,
      mem,
      decision,
      cartSummary: rt.ctx.cart.length
        ? `${summarizeCart(rt.ctx.cart)} — جمع ${this.cartTotal(rt.ctx.cart)} تومان`
        : 'خالی',
      catalogSize: facts.catalogSize,
      evidence,
      candidatesText: candidates.text,
      fallbackCatalogText,
      persuasionInstruction: persuasionEnabled
        ? `${PERSUASION_INSTRUCTION}${
            urgentDiscount
              ? `\n\nیک کد تخفیف واقعی و زمان‌دار همین الان فعال است: «${urgentDiscount.code}»، تا ${urgentDiscount.expiresAt.toLocaleString('fa-IR')} معتبر. فقط اگر به مکالمه مرتبط است طبیعی مطرحش کن.`
              : ''
          }`
        : null,
      leadCaptureInstruction: isNivoLeadStore(store)
        ? buildSalesLeadCaptureNote()
        : null,
      lastSearchLine: describeLastSearch(rt.ctx.lastSearch),
    });

    const respondToCustomer = tool({
      description:
        'پاسخ نهایی به مشتری را اعلام می‌کند — دقیقاً یک‌بار، به‌عنوان آخرین قدم (مگر وقتی create_order، update_cart برای محصول دارای سایز/رنگ، capture_lead یا request_human_handoff زده‌ای)',
      inputSchema: z.object({
        ...salesRespondShape,
        ...(persuasionEnabled ? persuasionShape : {}),
      }),
    });
    const tools = this.buildAgentTools(conversation, rt, {
      persuasionEnabled,
      respondToCustomer,
      searchProfile: await this.productFinder.getProfile(storeId, store.category),
    });
    const activeTools = decision.allowedTools.filter(
      (t) => t in tools,
    ) as (keyof typeof tools)[];
    const messages = buildChatMessages(history, customerMessage).map((m) =>
      m.role === 'user'
        ? {
            role: 'user' as const,
            content:
              typeof m.content === 'string' ? maskPaymentSecrets(m.content) : m.content,
          }
        : { role: 'assistant' as const, content: m.content },
    );
    const generate = (system: string) => {
      setCallSite('main_state_machine');
      return generateText({
        maxRetries: LLM_MAX_RETRIES,
        model: this.aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(model),
        tools,
        activeTools,
        stopWhen: stepCountIs(6),
        system,
        messages,
        temperature: 0.4,
      });
    };

    // خروج بدون respond_to_customer (فلو قطعی/handoff/salvage): حافظه همچنان ثبت می‌شود
    const finishPlain = async (
      engineResult: EngineResult,
      inputTokens: number,
      outputTokens: number,
    ) => {
      await this.persistSalesMemory(
        conversation,
        recordAgentTurn(mem, decision, {
          text: engineResult.reply,
          askedQuestion: null,
          quickReplies: [],
          shownProducts: [],
          cartProductIds: rt.ctx.cart.map((i) => i.productId),
          comparedProductIds: [],
        }),
        { progressHappened: rt.progressHappened, lastSearch: rt.ctx.lastSearch },
      );
      return { engineResult, inputTokens, outputTokens };
    };

    let result: Awaited<ReturnType<typeof generate>>;
    try {
      result = await generate(systemPrompt);
    } catch (err) {
      const caught = rt.handoffResult ?? rt.flowResult;
      if (caught) return finishPlain(caught, 0, 0);
      if (rt.mutationHappened) {
        return finishPlain(
          await this.salvageReplyAfterMutation(
            conversation,
            rt.orderResult,
            rt.cartResult,
          ),
          0,
          0,
        );
      }
      throw err;
    }
    let usedIn = result.totalUsage.inputTokens ?? 0;
    let usedOut = result.totalUsage.outputTokens ?? 0;

    const shortCircuit = rt.handoffResult ?? rt.flowResult;
    if (shortCircuit) return finishPlain(shortCircuit, usedIn, usedOut);

    type SalesRespondCall = {
      input: {
        text: string;
        relevantProductIds: string[];
        quickReplies: string[];
        askedQuestion: string | null;
        persuasionTechniquesUsed?: PersuasionTechnique[];
        usedGeneralKnowledge?: boolean;
      };
    };
    const findFinal = (r: typeof result) =>
      r.toolCalls.find((c) => c.toolName === 'respond_to_customer') as
        SalesRespondCall | undefined;
    let finalCall = findFinal(result);
    if (!finalCall) {
      if (rt.mutationHappened) {
        return finishPlain(
          await this.salvageReplyAfterMutation(
            conversation,
            rt.orderResult,
            rt.cartResult,
          ),
          usedIn,
          usedOut,
        );
      }
      throw new Error(
        'SALES_MACHINE did not call respond_to_customer within step limit',
      );
    }

    // §۱۱ — validator قطعی؛ مبلغ‌های معتبر = قیمت‌های واقعی ابزارها/سبد + هر عددی که خود پرامپت
    // (پروفایل/شواهد/کاندیدها) واقعاً دارد + بودجه‌ای که خود مشتری گفته
    const contract = contractFor(decision.goal, facts.catalogSize);
    const lastAgentMessage =
      [...history].reverse().find((h) => h.role === 'assistant')?.text ?? null;
    const knownAmounts = new Set<number>(extractNumbers(systemPrompt));
    for (const p of rt.seenProducts.values()) knownAmounts.add(p.basePrice);
    for (const i of mem.interests)
      if (i.priceToman > 0) knownAmounts.add(i.priceToman);
    for (const b of [mem.slots.budgetMaxToman, mem.slots.budgetMinToman]) {
      if (b !== null) knownAmounts.add(b);
    }
    const allowedAmounts = () => {
      const k = new Set(knownAmounts);
      for (const item of rt.ctx.cart) {
        k.add(item.unitPrice);
        k.add(item.unitPrice * item.qty);
      }
      k.add(this.cartTotal(rt.ctx.cart));
      if (rt.cartResult) k.add(rt.cartResult.total);
      if (rt.orderResult) k.add(rt.orderResult.amount);
      if (rt.ctx.appliedDiscount) k.add(rt.ctx.appliedDiscount.amountToman);
      return k;
    };
    const validate = (call: SalesRespondCall) =>
      validateReply({
        text: call.input.text.trim(),
        relevantProductIds: call.input.relevantProductIds ?? [],
        quickReplies: call.input.quickReplies ?? [],
        contract,
        mem,
        lastAgentMessage,
        knownAmounts: allowedAmounts(),
        catalogSize: facts.catalogSize,
        mutationShortCircuited: false,
        askedQuestion: call.input.askedQuestion,
      });

    let violations = validate(finalCall);
    const allViolations: Violation[] = [...violations];
    let correctiveRetry = false;
    if (violations.length > 0 && !rt.mutationHappened) {
      correctiveRetry = true;
      this.logger.warn(
        `SALES_MACHINE reply violations [${violations.map((v) => v.code).join(',')}], retrying once: conversation=${conversation.id}`,
      );
      try {
        const retry = await generate(
          `${systemPrompt}\n\n${buildCorrectiveInstruction(violations)}`,
        );
        usedIn += retry.totalUsage.inputTokens ?? 0;
        usedOut += retry.totalUsage.outputTokens ?? 0;
        const retryShortCircuit = rt.handoffResult ?? rt.flowResult;
        if (retryShortCircuit)
          return finishPlain(retryShortCircuit, usedIn, usedOut);
        const retryFinal = findFinal(retry);
        if (retryFinal) {
          result = retry;
          finalCall = retryFinal;
          violations = validate(retryFinal);
          allViolations.push(...violations);
        }
      } catch (err) {
        this.logger.error(
          `sales corrective retry failed, keeping original reply: conversation=${conversation.id}`,
          err as Error,
        );
      }
    } else if (
      rt.mutationHappened &&
      violations.some((v) => v.code === 'SUSPICIOUS_PRICE') &&
      (rt.cartResult || rt.orderResult)
    ) {
      // بعد از جهش retry ممنوع است؛ متن امن از روی واقعیت‌ها جایگزین می‌شود
      return finishPlain(
        await this.salvageReplyAfterMutation(
          conversation,
          rt.orderResult,
          rt.cartResult,
        ),
        usedIn,
        usedOut,
      );
    }

    // R1.4 — بعد از retry اصلاحی هنوز مبلغ غیرمجاز مانده؟ جمله حذف + «قیمت دقیق روی کارت»
    const text = await this.applyPriceGuard(
      conversation,
      finalCall.input.text.trim(),
      allowedAmounts(),
      correctiveRetry && allViolations.some((v) => v.code === 'SUSPICIOUS_PRICE') ? 1 : 0,
    );
    const relevantProductIds = finalCall.input.relevantProductIds ?? [];
    const askedQuestion = finalCall.input.askedQuestion?.trim() || null;
    const uiBlock = this.deriveFullAgentUiBlock({
      orderResult: rt.orderResult,
      cartResult: rt.cartResult,
      photosResult: rt.photosResult,
      compareResult: rt.compareResult,
      relevantProductIds,
      seenProducts: rt.seenProducts,
      toolFetchedProductIds: rt.toolFetchedProductIds,
    });
    const quickReplies = sanitizeQuickReplies(
      finalCall.input.quickReplies ?? [],
      {
        goal: decision.goal,
        uiBlockType: uiBlock.type,
      },
    );
    const lastShownProducts = relevantProductIds
      .filter((id) => rt.toolFetchedProductIds.has(id))
      .map((id) => rt.seenProducts.get(id))
      .filter((p): p is CompactProduct => !!p)
      .map((p) => ({ id: p.id, name: p.name }));
    const shownProducts =
      uiBlock.type === 'PRODUCT_CARD'
        ? uiBlock.products.map((p) => ({
            id: p.id,
            name: p.name,
            priceToman: p.basePrice,
          }))
        : [];

    const nextMem = recordAgentTurn(mem, decision, {
      text,
      askedQuestion,
      quickReplies,
      shownProducts,
      cartProductIds: rt.ctx.cart.map((i) => i.productId),
      comparedProductIds: rt.compareResult?.products.map((p) => p.id) ?? [],
    });
    await this.persistSalesMemory(conversation, nextMem, {
      lastShownProducts,
      progressHappened: rt.progressHappened,
      lastSearch: rt.ctx.lastSearch,
    });

    const suspiciousAmounts = allViolations.flatMap((v) =>
      v.code === 'SUSPICIOUS_PRICE' ? v.amounts : [],
    );
    await this.logReply(
      conversation,
      text,
      uiBlock,
      undefined,
      {
        intent: 'SALES_MACHINE',
        handler: 'callSalesTurn',
        factsOrPrompt: systemPrompt,
        model,
        ...(finalCall.input.persuasionTechniquesUsed?.length
          ? {
              persuasionTechniquesUsed:
                finalCall.input.persuasionTechniquesUsed,
            }
          : {}),
        ...(finalCall.input.usedGeneralKnowledge
          ? { usedGeneralKnowledge: true }
          : {}),
        salesStage: decision.stage,
        prevSalesStage: memBefore.stage,
        turnGoal: decision.goal,
        decisionReason: decision.reason,
        perception,
        perceptionFailed,
        validatorViolations: allViolations,
        correctiveRetry,
        candidateProductIds: candidates.ids,
        quickReplies,
        relevantProductIdsRaw: relevantProductIds,
        lastShownProducts,
        toolsCalled: result.steps
          .flatMap((s) => s.toolCalls)
          .filter((c) => c.toolName !== 'respond_to_customer')
          .map((c) => ({ name: c.toolName, args: c.input })),
        initialCatalogProductIds,
        stepsUsed: result.steps.length,
        mutationHappened: rt.mutationHappened,
        progressHappened: rt.progressHappened,
        isFallbackAttempt,
        ...(suspiciousAmounts.length
          ? { suspiciousPriceClaims: suspiciousAmounts }
          : {}),
      },
      quickReplies,
    );

    return {
      engineResult: {
        reply: text,
        uiBlocks: [uiBlock],
        state: conversation.currentState,
        ...(quickReplies.length ? { quickReplies } : {}),
      },
      inputTokens: usedIn,
      outputTokens: usedOut,
    };
  }

  private resolveProductRef(
    ctx: ConversationContext,
    parsed: ParsedIntent,
  ): { id: string; name: string } | null {
    if (parsed.productIndex) {
      return ctx.lastShownProducts?.[parsed.productIndex - 1] ?? null;
    }
    return null;
  }

  // docs/PRD-buyer-preference-personalization.md §۹.۳
  private async recordBuyerNeedCounts(
    customerId: string,
    tags: BuyerNeedTag[],
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { buyerNeedCounts: true },
    });
    const counts = {
      ...((customer?.buyerNeedCounts as Record<string, number> | null) ?? {}),
    };
    for (const tag of tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { buyerNeedCounts: counts },
    });
  }

  // 0.4 — شنونده‌ی نتیجه‌ی turnهای «صف‌شده» (پیام‌هایی که وسط پردازش یک turn دیگر رسیدند).
  // وب با polling جواب را می‌گیرد؛ تلگرام باید این نتیجه را خودش به چت بفرستد.
  private queuedResultListener:
    ((conversationId: string, result: EngineResult) => Promise<void>) | null =
    null;
  onQueuedTurnResult(
    fn: (conversationId: string, result: EngineResult) => Promise<void>,
  ) {
    this.queuedResultListener = fn;
  }

  private async reloadConversation(
    conversation: ConversationWithStore,
  ): Promise<ConversationWithStore> {
    // بعد از گرفتن قفل، state/context «تازه» از DB خوانده می‌شود (نسخه‌ی قبل از قفل کهنه است)
    return (
      (await this.prisma.salesConversation.findUnique({
        where: { id: conversation.id },
        include: { store: true },
      })) ?? conversation
    );
  }

  // 0.4 — پیام آزاد: اگر مکالمه در حال پردازش است، پیام در صف می‌رود و فوراً queued=true
  // برمی‌گردد؛ بعد از پایان turn جاری، پیام‌های صف با هم در «یک» turn پردازش می‌شوند.
  async handleMessage(
    conversation: ConversationWithStore,
    text: string,
    opts?: { clientMessageId?: string },
  ): Promise<EngineResult> {
    setLogCtx({ conversationId: conversation.id, storeId: conversation.storeId });
    let token = await this.lock.acquire(conversation.id);
    if (!token) {
      await this.lock.enqueue(conversation.id, text);
      return {
        reply: '',
        uiBlocks: [],
        state: conversation.currentState,
        queued: true,
      };
    }
    try {
      const startedAt = new Date();
      const first = await this.handleMessageInner(
        await this.reloadConversation(conversation),
        text,
        opts,
      );
      const endedAt = new Date();
      token = await this.drainPendingUnderLock(conversation, token);
      return await this.dropIfSellerTookOver(
        conversation,
        first,
        startedAt,
        endedAt,
      );
    } finally {
      if (token) await this.lock.release(conversation.id, token);
    }
  }

  // docs/PRD-seller-conversations-inbox.md §۴.۴ — فروشنده (humanTakenOverAt؛ handoff خودکار بات آن را
  // پر نمی‌کند) وسط تولید جواب AI دست گرفته؛ جواب نباید ذخیره/ارسال شود
  private async sellerTookOverMidTurn(conversationId: string): Promise<boolean> {
    // fail-open: خطای این چک نباید جواب عادی را از بین ببرد
    try {
      const row = await this.prisma.salesConversation.findUnique({
        where: { id: conversationId },
        select: { isMutedForHuman: true, humanTakenOverAt: true },
      });
      return !!row?.isMutedForHuman && !!row.humanTakenOverAt;
    } catch {
      return false;
    }
  }

  // اگر AGENT_REPLY همین turn (بین startedAt و endedAt) قبل از دست‌گرفتن ذخیره شده، ارسال می‌شود تا
  // آنچه مشتری می‌گیرد با تاریخچه‌ای که فروشنده می‌بیند یکی باشد؛ فقط جوابِ ذخیره‌نشده (logReply
  // به‌خاطر دست‌گرفتن ردش کرده) دور ریخته می‌شود
  private async dropIfSellerTookOver(
    conversation: ConversationWithStore,
    result: EngineResult,
    startedAt: Date,
    endedAt: Date,
  ): Promise<EngineResult> {
    if (!result.reply && result.uiBlocks.length === 0) return result;
    if (!(await this.sellerTookOverMidTurn(conversation.id))) return result;
    const persisted = await this.prisma.conversationEvent
      .findFirst({
        where: {
          conversationId: conversation.id,
          type: 'AGENT_REPLY',
          createdAt: { gte: startedAt, lte: endedAt },
        },
        select: { id: true },
      })
      .catch(() => null);
    if (persisted) return result;
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'SYSTEM',
        payload: { kind: 'AI_REPLY_DROPPED_TAKEOVER' },
      },
    });
    return { reply: '', uiBlocks: [], state: result.state };
  }

  // پیام‌های صف‌شده را (تا سقف دور) یکجا پردازش می‌کند؛ توکن قفل (احتمالاً تازه) یا null برمی‌گرداند
  private async drainPendingUnderLock(
    conversation: ConversationWithStore,
    token: string,
  ): Promise<string | null> {
    return runOutsideShopTurn(() => this.drainPendingBody(conversation, token));
  }

  private async drainPendingBody(
    conversation: ConversationWithStore,
    token: string,
  ): Promise<string | null> {
    let current: string | null = token;
    for (
      let round = 0;
      round < CONVERSATION_DRAIN_MAX_ROUNDS && current;
      round++
    ) {
      const pending = await this.lock.drain(conversation.id);
      if (pending.length === 0) {
        // پنجره‌ی race: پیامی بین drain و release صف شده باشد
        await this.lock.release(conversation.id, current);
        current = null;
        if ((await this.lock.pendingCount(conversation.id)) === 0) return null;
        current = await this.lock.acquire(conversation.id);
        continue;
      }
      try {
        const startedAt = new Date();
        const result = await this.handleMessageInner(
          await this.reloadConversation(conversation),
          pending.join('\n'),
        );
        await this.queuedResultListener?.(
          conversation.id,
          await this.dropIfSellerTookOver(
            conversation,
            result,
            startedAt,
            new Date(),
          ),
        );
      } catch (err) {
        this.logger.error(
          `queued turn failed (conversation=${conversation.id})`,
          err as Error,
        );
      }
    }
    return current;
  }

  // اکشن/رسید: برای آزاد شدن قفل تا چند ثانیه صبر می‌کنند؛ نشد → پیام «چند لحظه صبر کن»
  private async runActionLocked(
    conversation: ConversationWithStore,
    run: (fresh: ConversationWithStore) => Promise<EngineResult>,
  ): Promise<EngineResult> {
    const token = await this.lock.acquireWithRetry(conversation.id);
    if (!token) {
      return {
        reply: fa.salesAgent.conversationBusy,
        uiBlocks: [],
        state: conversation.currentState,
        busy: true,
      };
    }
    let held: string | null = token;
    try {
      const startedAt = new Date();
      const result = await run(await this.reloadConversation(conversation));
      const endedAt = new Date();
      held = await this.drainPendingUnderLock(conversation, token);
      return await this.dropIfSellerTookOver(
        conversation,
        result,
        startedAt,
        endedAt,
      );
    } finally {
      if (held) await this.lock.release(conversation.id, held);
    }
  }

  // 2.1 — هر turn یک deadline کل دارد (LLM_TURN_DEADLINE_MS) و call های LLM آن از guardFetch
  // (timeout هر call + سقف هم‌زمانی پاد) رد می‌شوند؛ در اشباع، پاسخ مهربان بدون هیچ write
  private async handleMessageInner(
    conversation: ConversationWithStore,
    text: string,
    opts?: { clientMessageId?: string },
  ): Promise<EngineResult> {
    const blocked = await this.guardStoreAndAi(conversation, text, true);
    if (blocked) return blocked;
    if (isLlmSaturated()) return this.saturatedResult(conversation);
    const engine = await resolveEngineMode(conversation.id, conversation.storeId);
    return this.withTurnReservation(conversation, () =>
      runLlmTurn(() => this.handleMessageTurn(conversation, text, opts), undefined, { storeId: conversation.storeId, conversationId: conversation.id, engine }).catch(
        (err: unknown) => this.onTurnError(conversation, err),
      ),
    );
  }

  // R1.4 — گارد قیمت در مسیر زنده. اگر هنوز مبلغ غیرمجاز در متن مانده، جمله‌ی حاوی آن حذف و
  // «قیمت دقیق رو روی کارت محصول ببین» اضافه می‌شود؛ در استریم رویداد `replace` با متن نهایی
  // می‌رود. هر بار که گارد وارد عمل شد (retry یا حذف) ProductEvent `price_guard_triggered` ثبت می‌شود.
  private async applyPriceGuard(
    conversation: ConversationWithStore,
    text: string,
    allowed: Set<number>,
    retries: number,
  ): Promise<string> {
    const stripped = stripUnauthorizedPriceSentences(
      text,
      allowed,
      fa.salesAgent.priceSeeCard,
    );
    // QA-17 — جداکننده‌ی هزارگان برای مبلغ‌های متن آزاد (بعد از گارد قیمت، که روی عدد خام کار می‌کند)
    const formatted = formatTomanAmountsInText(stripped.text);
    if (stripped.changed || formatted !== stripped.text) emitShopReplace(formatted);
    if (retries > 0 || stripped.changed) {
      this.logger.warn(
        `price guard: retries=${retries} stripped=${stripped.changed} conversation=${conversation.id}`,
      );
      this.productEvents.log(
        'price_guard_triggered',
        { storeId: conversation.storeId, conversationId: conversation.id },
        { retries, stripped: stripped.changed },
      );
    }
    return formatted;
  }

  // R1.2 — فروشگاه معلق: پیام ثابت، بدون هیچ call مدل و بدون سفارش جدید. kill switch AI
  // (فقط پیام آزاد): handoff مهربان بدون LLM؛ پیام خریدار لاگ می‌شود تا فروشنده ببیند.
  private async guardStoreAndAi(
    conversation: ConversationWithStore,
    text: string | null,
    isMessage: boolean,
  ): Promise<EngineResult | null> {
    if (conversation.store?.status === 'SUSPENDED') {
      return {
        reply: fa.store.suspended,
        uiBlocks: [],
        state: conversation.currentState,
      };
    }
    if (!isMessage) return null;
    // خواندن کانفیگ شکست خورد ← fail-open (سوییچ خاموش فرض می‌شود، چت نباید از کار بیفتد)
    const cfg = await getSalesAgentGlobalConfig(this.prisma).catch(() => null);
    if (!cfg || cfg.aiEnabled) return null;
    if (text) {
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'CUSTOMER_MESSAGE',
          payload: { text },
        },
      });
      await touchConversation(this.prisma, conversation.id, 'CUSTOMER');
    }
    if (conversation.currentState === 'HANDOFF_HUMAN') {
      return {
        reply: fa.salesAgent.aiDisabledHandoff,
        uiBlocks: [],
        state: conversation.currentState,
      };
    }
    return this.transitionToHandoff(conversation, 'AI_DISABLED');
  }

  // 1.2(۱) — کف overdraft: هر turn قبل از شروع، برآورد هزینه‌اش را از موجودی قابل‌خرج رزرو
  // می‌کند (کش Redis ۳۰ثانیه‌ای + شمارنده‌ی رزرو)؛ اگر از کف رد شود همان handoff «فروشنده شخصاً
  // جواب می‌دهد» (BILLING_BLOCKED). مکالمه‌ی از قبل BLOCKED رزرو نمی‌خواهد (خودش handoff می‌شود).
  private async withTurnReservation(
    conversation: ConversationWithStore,
    run: () => Promise<EngineResult>,
  ): Promise<EngineResult> {
    if (conversation.billingMode === 'BLOCKED') return run();
    const reserved = await this.creditService.reserveTurn(conversation.storeId);
    if (!reserved)
      return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
    try {
      return await run();
    } finally {
      await this.creditService.releaseTurn(conversation.storeId);
    }
  }

  private saturatedResult(conversation: ConversationWithStore): EngineResult {
    return {
      reply: fa.salesAgent.llmSaturated,
      uiBlocks: [],
      state: conversation.currentState,
      busy: true,
    };
  }

  private onTurnError(
    conversation: ConversationWithStore,
    err: unknown,
  ): EngineResult {
    if (err instanceof LlmSaturatedError)
      return this.saturatedResult(conversation);
    throw err;
  }

  private async handleMessageTurn(
    conversation: ConversationWithStore,
    text: string,
    opts?: { clientMessageId?: string },
  ): Promise<EngineResult> {
    // 2.6 — گارد سوءاستفاده قبل از هر نوشتن: پیام کاربرِ قفل‌شده نباید حتی یک ConversationEvent
    // بسازد (وگرنه spam، جدول eventها را بی‌سقف پر می‌کند)
    const abuseResult = await this.checkAbuseGuard(conversation);
    if (abuseResult) return abuseResult;

    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'CUSTOMER_MESSAGE',
        payload: {
          text,
          ...(opts?.clientMessageId
            ? { clientMessageId: opts.clientMessageId }
            : {}),
        },
      },
    });
    await touchConversation(this.prisma, conversation.id, 'CUSTOMER');

    const demoCapResult = await this.checkDemoMessageCap(conversation);
    if (demoCapResult) return demoCapResult;

    // docs/PRD-customer-comments-and-discounts.md بخش الف/۳ — بعد از تایید سفارش (COMPLETED)
    // یک پیام پیگیری باز می‌شود؛ اولین پیام آزاد بعدی مستقیم متن نظر می‌شود، بدون فراخوان AI
    // (نه parseIntent، نه هزینه‌ای برای فروشگاه)
    const awaitingReview = (
      conversation.contextData as {
        awaitingReview?: boolean;
        awaitingReviewProductId?: string | null;
      } | null
    )?.awaitingReview;
    if (conversation.currentState === 'COMPLETED' && awaitingReview) {
      return this.doSubmitComment(conversation, { text });
    }

    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۳ — فالوآپ رضایت (چند روز بعد، صف
    // PostPurchaseFollowUpService) این فلگ را ست کرده؛ اولین پیام آزاد بعدی *احتمالاً* جواب
    // همان سؤال است، ولی doSatisfactionReply خودش با AI چک می‌کند که واقعاً همین‌طور است یا نه
    // (مثلاً ممکن است مشتری بعد از چند روز یک درخواست خرید کاملاً جدید فرستاده باشد) — اگر
    // بی‌ربط تشخیص داد null برمی‌گرداند تا پیام از مسیر عادی (پایین همین متد) پردازش شود
    const awaitingSatisfactionCheck = (
      conversation.contextData as { awaitingSatisfactionCheck?: boolean } | null
    )?.awaitingSatisfactionCheck;
    if (
      conversation.currentState === 'COMPLETED' &&
      awaitingSatisfactionCheck
    ) {
      const satisfactionResult = await this.doSatisfactionReply(
        conversation,
        text,
      );
      if (satisfactionResult) return satisfactionResult;
    }

    if (this.billingBlocked(conversation)) {
      return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
    }

    // docs/PRD-buyer-payment-method-card-or-snapppay-link.md بخش ۳ — لینک اسنپ‌پی ثابت است
    // و callback ندارد، پس کد رهگیری تنها از متن آزاد خریدار قابل‌دریافت است. عمداً روی
    // AWAITING_PAYMENT/AWAITING_SELLER_APPROVAL هر دو چک می‌شود (نه فقط اولی) چون ترتیب
    // ارسال اسکرین‌شات/کد رهگیری توسط خریدار تضمین‌شده نیست (ممکن است عکس را زودتر بفرستد)
    if (
      conversation.currentState === 'AWAITING_PAYMENT' ||
      conversation.currentState === 'AWAITING_SELLER_APPROVAL'
    ) {
      const pendingOrder = await this.prisma.order.findUnique({
        where: { conversationId: conversation.id },
      });
      if (
        pendingOrder?.paymentMethod === 'SNAPPPAY' &&
        !pendingOrder.snapppayTrackingCode &&
        (pendingOrder.status === 'PENDING_PAYMENT' ||
          pendingOrder.status === 'RECEIPT_SUBMITTED')
      ) {
        return this.handleSnapppayTrackingCodeInput(
          conversation,
          pendingOrder,
          text,
        );
      }
    }

    // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — عیناً همان الگوی
    // ADDRESS_COLLECTION پایین: پیام آزاد حین PAYMENT_METHOD_SELECTION هیچ‌وقت از parseIntent
    // رد نمی‌شود، چون «کارت» یا «اسنپ» برای مدل intent عمومی چیزی برای classify کردن ندارد
    if (conversation.currentState === 'PAYMENT_METHOD_SELECTION') {
      return this.handlePaymentMethodSelectionInput(
        conversation,
        this.getContext(conversation),
        text,
      );
    }

    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ — دقیقاً همان الگوی
    // awaitingReview/awaitingSatisfactionCheck بالا: پیام آزاد حین ADDRESS_COLLECTION هیچ‌وقت
    // از parseIntent رد نمی‌شود، یک state machine قطعی روی ctx.addressStep است
    if (conversation.currentState === 'ADDRESS_COLLECTION') {
      return this.handleAddressInput(
        conversation,
        this.getContext(conversation),
        text,
      );
    }

    // docs/PRD-product-display-focus-and-variations.md §۴.۲ — عیناً همان الگوی ADDRESS_COLLECTION
    // بالا: پیام آزاد حین انتخاب واریانت هیچ‌وقت از parseIntent رد نمی‌شود، چون «آبی» یا
    // «سایز M» برای مدل intent عمومی چیزی برای classify کردن ندارد — یک تطبیق متنی ساده روی
    // مقادیر همان بُعدِ در انتظار کافی‌ست (resolveVariantSelectionValue)
    const pendingVariantCtx = this.getContext(conversation);
    if (pendingVariantCtx.pendingVariantSelection) {
      return this.handleVariantSelectionInput(
        conversation,
        pendingVariantCtx,
        text,
      );
    }

    // docs/PRD-sales-agent-tool-calling-architecture.md بخش ۳.۱ — شاخه‌ی کاملاً جدید و
    // افزودنی، دقیقاً مثل الگوی امن SIMPLE_AGENT قبلی: parseIntent+switch+do* زیرش دست‌نخورده
    // می‌ماند، برای مکالمه‌های FULL_AGENT اجرا نمی‌شود. از ۱۴۰۵/۰۷/۱۲ همه‌ی مکالمه‌های تازه
    // FULL_AGENT هستند (model-variants.ts)، پس این شاخه مسیر زنده‌ی پروداکشن است
    if (conversation.responseStrategy === 'FULL_AGENT') {
      return this.runFullAgentTurn(conversation, text);
    }

    const parsed = await this.parseIntent(text, conversation);
    const ctx = this.getContext(conversation);

    // docs/PRD-product-display-focus-and-variations.md §۲.۳ — لنگر محصول را حفظ می‌کنیم مگر
    // مشتری صریح محصول دیگری بخواهد (پایین‌تر، شاخه‌ی BROWSE با productQuery) یا دو پیام
    // متوالی نشانه‌ی تردید/نارضایتی بدهد — آن‌وقت لنگر برداشته می‌شود و doBrowse همان محصول
    // را از پیشنهادهای جایگزین حذف می‌کند (anchorJustDropped)
    let anchorJustDropped: string | null = null;
    if (ctx.anchoredProductId) {
      if (parsed.intent === 'ADD_TO_CART') {
        ctx.anchorHesitationStreak = 0;
      } else if (
        parsed.buyerNeeds?.includes('PURCHASE_HESITATION') ||
        parsed.buyerNeeds?.includes('BOT_FRUSTRATION')
      ) {
        ctx.anchorHesitationStreak = (ctx.anchorHesitationStreak ?? 0) + 1;
      }
      if ((ctx.anchorHesitationStreak ?? 0) >= 2) {
        anchorJustDropped = ctx.anchoredProductId;
        ctx.anchoredProductId = null;
        ctx.anchorHesitationStreak = 0;
      }
    }

    // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۴.۲ — trace سطح classification، جدا از
    // trace های اختصاصی هر handler در logReply؛ چون بلافاصله بعد از CUSTOMER_MESSAGE و قبل از
    // هر AGENT_REPLY نوشته می‌شود، getConversationTrace فعلی (که trace را به AGENT_REPLY بعدش
    // می‌چسباند) این را نادیده می‌گیرد نه خراب می‌کند — نمایش در ادمین یک گام بعدی جداست
    // شرط ثبت عمداً intentConfidence!=='HIGH' را هم شامل می‌شود (نه فقط buyerNeeds/unmatched) —
    // این دقیقاً سیگنالی است که بخش «Potential misclassification» بخش ۵.۱ سند به آن نیاز داشت،
    // مستقل از اینکه پیام اصلاً buyerNeeds شناخته‌شده‌ای هم داشته باشد یا نه
    if (
      parsed.buyerNeeds?.length ||
      parsed.unmatchedBuyerNeed ||
      (parsed.intentConfidence && parsed.intentConfidence !== 'HIGH')
    ) {
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'AI_TRACE',
          payload: {
            intent: parsed.intent,
            handler: 'parseIntent',
            buyerNeeds: parsed.buyerNeeds ?? [],
            ...(parsed.unmatchedBuyerNeed
              ? { unmatchedBuyerNeed: parsed.unmatchedBuyerNeed }
              : {}),
            ...(parsed.intentConfidence
              ? { intentConfidence: parsed.intentConfidence }
              : {}),
          },
        },
      });
    }

    // docs/PRD-buyer-preference-personalization.md §۹.۳ — فاز ۱: فقط تجمیع، هیچ رفتار
    // ایجنتی از رویش تصمیم نمی‌گیرد. عمداً read-merge-write ساده (نه raw SQL atomic
    // increment) — این یک شمارنده‌ی تحلیلی کم‌ریسک است، نه داده‌ی مالی؛ پیام‌های یک مشتری
    // هم عملاً پشت‌سرهم می‌آیند، نه هم‌زمان
    if (parsed.buyerNeeds?.length) {
      await this.recordBuyerNeedCounts(
        conversation.customerId,
        parsed.buyerNeeds,
      );
    }

    // همان سند، بخش ۲ — گروه‌های P1 (پرداخت/پس از خرید): ربات فعلاً Tool ای برای حل این‌ها
    // ندارد، پس به‌جای پاسخ نصفه‌ونیمه‌ی ASK_FAQ، مستقیم به فروشنده ارجاع می‌شود. اولویت روی
    // REQUEST_HUMAN صریح نیست چون این چک زودتر (بالا) رد شده — یعنی اگر مشتری هم صریح انسان
    // خواسته باشد هم مشکل پرداخت مطرح کرده، همان مسیر REQUEST_HUMAN می‌رود، تکراری نمی‌شود
    if (
      parsed.buyerNeeds?.includes('PAYMENT_ISSUE') ||
      parsed.buyerNeeds?.includes('POST_PURCHASE_SUPPORT')
    ) {
      return this.transitionToHandoff(conversation, 'SUPPORT_NEEDED');
    }

    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۳ — قبلاً «عکس بیشتر بده»/«چه شکلیه؟»
    // یا به ASK_FAQ می‌رفت (که اصلاً uiBlock نمی‌فرستد) یا حداکثر از PRODUCT_CARD موجود یک
    // عکس (images[0]) می‌گرفت. فقط وقتی محصول قابل‌شناسایی باشد وارد می‌شویم؛ وگرنه جریان
    // عادی (switch پایین) همان مسیر همیشگی‌اش را می‌رود. اکشن‌های قطعی (پرداخت/لغو/تخفیف) را
    // عمداً رد می‌کند تا عکس‌خواهی حین آن‌ها جریان تصمیم‌گیری را منحرف نکند
    if (
      parsed.buyerNeeds?.includes('REQUEST_MORE_PHOTOS') &&
      !['CHECKOUT', 'CONFIRM', 'CANCEL', 'APPLY_DISCOUNT'].includes(
        parsed.intent,
      )
    ) {
      const photosResult = await this.doShowPhotos(conversation, ctx, parsed);
      if (photosResult) return photosResult;
    }

    // docs/PRD-product-display-focus-and-variations.md §۲.۲ — پیام عمومی («بیشتر بگو»/«چیز
    // دیگه هم داری») حین anchor بودن، به‌جای جستجوی چندمحصولی عادی، دوباره روی همان محصول
    // لنگر متمرکز می‌شود. وقتی مشتری صریح چیز دیگری خواسته (productQuery ست است)، این شرط
    // رد می‌شود و doBrowse عادی پایین اجرا می‌شود (که لنگر را هم پاک می‌کند)
    if (
      ctx.anchoredProductId &&
      parsed.intent === 'BROWSE' &&
      !parsed.productQuery
    ) {
      const anchoredProduct = await this.prisma.product.findUnique({
        where: { id: ctx.anchoredProductId, ...BUYER_VISIBLE },
        include: PRODUCT_VARIANT_INCLUDE,
      });
      if (anchoredProduct && anchoredProduct.storeId === conversation.storeId) {
        return this.showProduct(
          conversation,
          anchoredProduct,
          ctx.anchorHesitationStreak,
        );
      }
    }

    switch (parsed.intent) {
      case 'BROWSE':
        return this.doBrowse(conversation, parsed, text, anchorJustDropped);
      case 'ADD_TO_CART':
      case 'REMOVE_FROM_CART':
        return this.doUpdateCart(conversation, ctx, parsed);
      case 'VIEW_CART':
        return this.doViewCart(conversation, ctx);
      case 'CHECKOUT':
      case 'CONFIRM':
        if (conversation.currentState === 'CART_REVIEW') {
          return this.doCreateOrder(conversation, ctx);
        }
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      case 'CANCEL':
        return this.doCancel(conversation);
      case 'ASK_FAQ':
        return this.doFaq(conversation, text, ctx);
      case 'APPLY_DISCOUNT':
        if (conversation.currentState === 'CART_REVIEW') {
          return this.doApplyDiscount(conversation, ctx, parsed.discountCode);
        }
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      default:
        return this.doClarifyUnclear(conversation);
    }
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۳ — همان منطق شناسایی محصول doUpdateCart
  // (ایندکس صریح از lastShownProducts، وگرنه جستجوی نام). null یعنی «محصول قابل‌شناسایی نبود»؛
  // handleMessage در این حالت جریان عادی (switch) را ادامه می‌دهد، نه یک پیام خطای جدا درباره‌ی
  // عکس — چون intent اصلی (مثلاً ASK_FAQ) همچنان باید جواب خودش را بدهد
  private async doShowPhotos(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    parsed: ParsedIntent,
  ): Promise<EngineResult | null> {
    const ref = this.resolveProductRef(ctx, parsed);
    const product = ref
      ? await this.prisma.product.findUnique({ where: { id: ref.id, ...BUYER_VISIBLE } })
      : parsed.productQuery
        ? (
            await this.searchProducts(conversation.storeId, parsed.productQuery)
          )[0]
        : null;
    if (!product || product.storeId !== conversation.storeId) return null;
    if (product.images.length === 0) return null;

    const uiBlock: UiBlock = {
      type: 'PRODUCT_PHOTOS',
      productId: product.id,
      productName: product.name,
      images: product.images,
      videos: parseProductVideos(product.videos),
    };
    const reply = fa.salesAgent.photosCaption(product.name);
    await this.logReply(conversation, reply, uiBlock, undefined, {
      intent: parsed.intent,
      handler: 'doShowPhotos',
      factsOrPrompt: product.name,
      model: resolveModel(conversation.abVariant),
    });
    return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
  }

  // docs/PRD-customer-comments-and-discounts.md بخش الف/۳ — همان متن آزاد مشتری، بدون هیچ NLU،
  // مستقیم یک ProductComment (PENDING) می‌شود؛ awaitingReview پاک می‌شود تا پیام بعدی دوباره
  // نظر تلقی نشود
  // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۱ — قبلاً فقط
  // امضای `text: string` داشت (فقط پیام تایپی). حالا هر کانال ورودی (submitImageMessage،
  // submitVoiceMessage، submitVideoMessage) هم وقتی awaitingReview ست باشد مستقیم همین متد را
  // با کلید رسانه‌ی خودش صدا می‌زند — حداقل یکی از چهار فیلد باید پر باشد (گارد واقعی در
  // CommentsService.submitComment)
  private async doSubmitComment(
    conversation: ConversationWithStore,
    input: {
      text?: string;
      imageKey?: string;
      videoKey?: string;
      audioKey?: string;
    },
  ): Promise<EngineResult> {
    const existingContext = (conversation.contextData ??
      {}) as Prisma.JsonObject & {
      awaitingReviewProductId?: string | null;
    };
    const productId = existingContext.awaitingReviewProductId ?? null;

    await this.comments.submitComment({
      storeId: conversation.storeId,
      customerId: conversation.customerId,
      productId,
      text: input.text,
      imageKey: input.imageKey,
      videoKey: input.videoKey,
      audioKey: input.audioKey,
    });

    const { awaitingReview, awaitingReviewProductId, ...rest } =
      existingContext;
    void awaitingReview;
    void awaitingReviewProductId;
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: { contextData: rest },
    });

    const reply = fa.salesAgent.reviewThanks;
    await this.logReply(conversation, reply, { type: 'NONE' });
    return { reply, uiBlocks: [], state: conversation.currentState };
  }

  // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۱ — ورودی عمومی
  // برای sales-agent.service.ts (submitImageMessage/submitVoiceMessage/submitVideoMessage)
  // وقتی خودشان از قبل چک کرده‌اند conversation.contextData.awaitingReview ست است؛ doSubmitComment
  // بالا خصوصی می‌ماند (فقط برای مسیر متنی handleMessage)
  async submitReviewMedia(
    conversation: ConversationWithStore,
    input: {
      text?: string;
      imageKey?: string;
      videoKey?: string;
      audioKey?: string;
    },
  ): Promise<EngineResult> {
    return this.doSubmitComment(conversation, input);
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۳ — طبقه‌بندی جواب مشتری به فالوآپ رضایت.
  // نسخه‌ی اول این هیورستیک کلیدواژه‌ی ساده بود (مثلاً .includes('مشکل')) ولی فالس‌پازیتیو
  // واقعی داشت («مشکلی نداشتم، همه چیز عالی بود» را منفی تشخیص می‌داد چون منفی‌سازی جمله را
  // نمی‌فهمید) — جایگزین شد با یک فراخوان AI بسیار کوچک که هم منفی‌سازی را می‌فهمد هم اصلاً
  // تشخیص می‌دهد که پیام واقعاً جواب این سؤال هست یا نه (UNRELATED)
  private async callSatisfactionClassify(
    text: string,
    model: string,
  ): Promise<{
    verdict: 'POSITIVE' | 'NEGATIVE' | 'UNRELATED';
    inputTokens: number;
    outputTokens: number;
  }> {
    setCallSite('satisfaction');
    const { object, usage } = await generateObject({
      maxRetries: LLM_MAX_RETRIES,
      model: this.aiProvider.buildClient(undefined, {
        supportsStructuredOutputs: true,
      })(model),
      schema: z.object({
        verdict: z.enum(['POSITIVE', 'NEGATIVE', 'UNRELATED']),
      }),
      system: `چند روز پیش این مشتری از یک فروشگاه اینستاگرامی خرید کرده و همین الان این پیام
برایش فرستاده شده: «چند روزی از خریدت گذشته — همه‌چیز خوب بود؟». پیام زیر جواب مشتری به همین
سؤال است. یکی از این سه حالت را تشخیص بده:
- POSITIVE: راضی بوده/مشکلی نداشته (حتی اگر با جمله‌ی منفی مثل «مشکلی نبود» یا «بد نبود» بیان
  شده باشد — منفی‌سازی جمله را در نظر بگیر، نه فقط وجود کلمه‌ی منفی)
- NEGATIVE: از خرید/محصول/ارسال ناراضی بوده یا مشکل واقعی مطرح کرده
- UNRELATED: پیام اصلاً جواب این سؤال نیست — مثلاً می‌خواهد چیز دیگری بخرد، سؤال تازه‌ای دارد،
  یا کلاً بی‌ربط به رضایت از این خرید است
فقط JSON مطابق schema برگردان.`,
      prompt: text,
    });
    return {
      verdict: object.verdict,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    };
  }

  // همان الگوی fallback دومرحله‌ای parseIntent/caption؛ اگر هر دو تلاش شکست خورد، امن‌ترین
  // پیش‌فرض UNRELATED است (نه POSITIVE/NEGATIVE حدسی) — یعنی پیام از مسیر عادی پردازش می‌شود
  // به‌جای اینکه با یک نتیجه‌ی حدسی به فروشنده یا مشتری جواب غلط داده شود
  private async classifySatisfactionReply(
    text: string,
    conversation: ConversationWithStore,
  ): Promise<'POSITIVE' | 'NEGATIVE' | 'UNRELATED'> {
    // ACE-5 — موتور بهینه + subcallDiet: طبقه‌بندی رضایت با مدل سبک
    const lightSat = await aceActive('subcallDiet');
    if (lightSat) aceNote('subcallDiet', 'طبقه‌بندی رضایت با مدل سبک انجام شد (به‌جای مدل اصلی)', 'satisfaction');
    const primaryModel = lightSat
      ? PERCEPTION_MODEL
      : resolveModel(conversation.abVariant);
    const started = Date.now();
    try {
      const { verdict, inputTokens, outputTokens } =
        await this.callSatisfactionClassify(text, primaryModel);
      await this.logAiCall(
        conversation,
        'SATISFACTION_CLASSIFY',
        true,
        Date.now() - started,
      );
      await this.logTextCreditUsage(
        conversation,
        primaryModel,
        inputTokens,
        outputTokens,
      );
      return verdict;
    } catch (err) {
      this.logger.error(
        `classifySatisfactionReply failed (model=${primaryModel}, conversation=${conversation.id})`,
        err as Error,
      );
      await this.logAiCall(
        conversation,
        'SATISFACTION_CLASSIFY',
        false,
        Date.now() - started,
      );
      if (primaryModel === defaultModel()) return 'UNRELATED';
      const fallbackStarted = Date.now();
      try {
        const { verdict, inputTokens, outputTokens } =
          await this.callSatisfactionClassify(text, defaultModel());
        await this.logAiCall(
          conversation,
          'SATISFACTION_CLASSIFY',
          true,
          Date.now() - fallbackStarted,
        );
        await this.logTextCreditUsage(
          conversation,
          defaultModel(),
          inputTokens,
          outputTokens,
        );
        return verdict;
      } catch (fallbackErr) {
        this.logger.error(
          `classifySatisfactionReply fallback failed (model=${defaultModel()}, conversation=${conversation.id})`,
          fallbackErr as Error,
        );
        await this.logAiCall(
          conversation,
          'SATISFACTION_CLASSIFY',
          false,
          Date.now() - fallbackStarted,
        );
        const chained = await this.tryModelFallbackChain(
          conversation,
          'SATISFACTION_CLASSIFY',
          'classifySatisfactionReply',
          (model) =>
            this.callSatisfactionClassify(text, model).then(
              ({ verdict, inputTokens, outputTokens }) => ({
                result: verdict,
                inputTokens,
                outputTokens,
              }),
            ),
        );
        return chained ?? 'UNRELATED';
      }
    }
  }

  // null برمی‌گرداند یعنی «این پیام جواب رضایت نبود» — handleMessage در این حالت باید همان
  // پیام را از مسیر عادی (parseIntent/doBrowse/...) رد کند، نه اینکه بی‌صدا گمش کند
  private async doSatisfactionReply(
    conversation: ConversationWithStore,
    text: string,
  ): Promise<EngineResult | null> {
    const existingContext = (conversation.contextData ??
      {}) as Prisma.JsonObject & { awaitingSatisfactionCheck?: boolean };
    const { awaitingSatisfactionCheck, ...rest } = existingContext;
    void awaitingSatisfactionCheck;

    // بدون اعتبار، حتی برای طبقه‌بندی هم AI صدا زده نمی‌شود — می‌گذاریم جریان عادی (که خودش
    // بلافاصله بعد از این چک وارد billingBlocked می‌شود و handoff می‌کند) پیام را ببیند
    if (this.billingBlocked(conversation)) {
      await this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: { contextData: rest },
      });
      return null;
    }

    const verdict = await this.classifySatisfactionReply(text, conversation);
    // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۳ — بدون این، نرخ جواب‌دهی/نسبت
    // POSITIVE-NEGATIVE-UNRELATED قابل محاسبه نبود (verdict قبلاً فقط برای انتخاب پاسخ مصرف
    // می‌شد و بعدش دور ریخته می‌شد). همان الگوی AI_TRACE موجود (handler:'parseIntent')، صفر migration
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'AI_TRACE',
        payload: { handler: 'satisfactionClassify', verdict },
      },
    });

    if (verdict === 'UNRELATED') {
      await this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: { contextData: rest },
      });
      return null;
    }

    const negative = verdict === 'NEGATIVE';
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: {
        contextData: rest,
        ...(negative ? { isMutedForHuman: true } : {}),
      },
    });

    const reply = negative
      ? fa.salesAgent.satisfactionNegativeAck
      : fa.salesAgent.satisfactionThanksAck;
    await this.logReply(conversation, reply, { type: 'NONE' });
    return { reply, uiBlocks: [], state: conversation.currentState };
  }

  // اعتبارسنجی/پیش‌نمایش خالص (بدون پرسیست) — docs/PRD-sales-agent-tool-calling-architecture.md
  // بخش ۳.۳ (ابزار apply_discount) هم عیناً همین تابع را صدا می‌زند
  private async previewDiscount(
    storeId: string,
    cart: CartItem[],
    rawCode: string | null | undefined,
  ): Promise<
    | {
        valid: true;
        id: string;
        code: string;
        amountToman: number;
        newTotal: number;
      }
    | {
        valid: false;
        reason:
          | 'MISSING'
          | 'INVALID'
          | 'MIN_QUANTITY_NOT_MET'
          | 'PRODUCT_NOT_IN_CART';
        minQuantity?: number;
      }
  > {
    if (!rawCode) return { valid: false, reason: 'MISSING' };
    const normalized = rawCode.trim().toUpperCase();
    const discount = await this.prisma.storeDiscountCode.findFirst({
      where: {
        storeId,
        code: normalized,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    const valid =
      discount &&
      (discount.maxRedemptions == null ||
        discount.redemptionCount < discount.maxRedemptions);
    if (!valid) return { valid: false, reason: 'INVALID' };

    // docs/PRD-customer-comments-and-discounts.md بخش ۱۳ — وقتی کد محدود به یک محصول خاص است،
    // مبلغ/حداقل تعداد فقط روی ردیف همان محصول در سبد حساب می‌شود، نه کل سبد
    const scopedItems = discount.productId
      ? cart.filter((item) => item.productId === discount.productId)
      : cart;
    if (discount.productId && scopedItems.length === 0) {
      return { valid: false, reason: 'PRODUCT_NOT_IN_CART' };
    }
    const scopedTotal = this.cartTotal(scopedItems);
    const scopedQuantity = this.cartQuantity(scopedItems);

    if (discount.minQuantity && scopedQuantity < discount.minQuantity) {
      return {
        valid: false,
        reason: 'MIN_QUANTITY_NOT_MET',
        minQuantity: discount.minQuantity,
      };
    }

    const amountToman =
      discount.kind === 'PERCENT'
        ? Math.floor((scopedTotal * discount.value) / 100)
        : Math.min(discount.value, scopedTotal);
    return {
      valid: true,
      id: discount.id,
      code: normalized,
      amountToman,
      newTotal: this.cartTotal(cart) - amountToman,
    };
  }

  // docs/PRD-customer-comments-and-discounts.md بخش ۹ — فقط پیش‌نمایش/اعتبارسنجی؛ مصرف واقعی
  // (atomic increment) در doCreateOrder اتفاق می‌افتد، چون ممکن است خریدار قبل از پرداخت پشیمان شود
  private async doApplyDiscount(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    rawCode: string | null | undefined,
  ): Promise<EngineResult> {
    const preview = await this.previewDiscount(
      conversation.storeId,
      ctx.cart,
      rawCode,
    );
    if (!preview.valid) {
      return this.doClarify(
        conversation,
        preview.reason === 'MISSING'
          ? fa.salesAgent.discountCodeMissing
          : preview.reason === 'MIN_QUANTITY_NOT_MET'
            ? fa.salesAgent.discountCodeMinQuantityNotMet(preview.minQuantity!)
            : preview.reason === 'PRODUCT_NOT_IN_CART'
              ? fa.salesAgent.discountCodeProductNotInCart
              : fa.salesAgent.discountCodeInvalid,
      );
    }

    const nextCtx: ConversationContext = {
      ...ctx,
      appliedDiscount: {
        id: preview.id,
        code: preview.code,
        amountToman: preview.amountToman,
      },
    };
    await this.persistTransition(conversation, 'CART_REVIEW', nextCtx);

    const uiBlock: UiBlock = {
      type: 'CART_SUMMARY',
      items: ctx.cart,
      total: preview.newTotal,
    };
    const facts = `کد تخفیف ${preview.code} اعمال شد — ${preview.amountToman} تومان تخفیف. جمع جدید سبد: ${preview.newTotal} تومان`;
    const reply = await this.caption(facts, conversation);
    await this.logReply(conversation, reply, uiBlock, undefined, {
      intent: 'APPLY_DISCOUNT',
      handler: 'doApplyDiscount',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
    return { reply, uiBlocks: [uiBlock], state: 'CART_REVIEW' };
  }

  // مسیر قطعی دکمه‌های UiBlock (افزودن به سبد/تایید سبد) — بدون NLU، productId از خودِ
  // دکمه معلوم است؛ فیدبک اول پایلوت: قبلاً این دکمه‌ها یک جمله‌ی فارسی می‌ساختند و دوباره
  // از parseIntent رد می‌شدند (گاهی «نامفهوم» تشخیص داده می‌شد)
  // 0.13b + تصمیم D-2 — Order.conversationId یکتاست؛ اگر این مکالمه از قبل «هر» سفارشی دارد
  // (در هر وضعیتی)، «سفارش مجدد» و «افزودن به سبد» نباید روی همان مکالمه سبد بسازند (تایید سبد
  // سفارش قدیمی را برمی‌گرداند و اقلام جدید گم می‌شوند). مکالمه‌ی قبلی برای پیگیری سفارش
  // باقی می‌ماند (فقط آرشیو می‌شود) و یک مکالمه‌ی تازه‌ی همان خریدار ساخته می‌شود.
  // کلاینت وب با switchedConversationId به مکالمه‌ی جدید می‌رود؛ تلگرام خودش مکالمه‌ی
  // غیرآرشیو را پیدا می‌کند (resolveActiveConversation).
  private async forkConversationIfOrdered(
    conversation: ConversationWithStore,
  ): Promise<ConversationWithStore> {
    const existing = await this.prisma.order.findUnique({
      where: { conversationId: conversation.id },
      select: { id: true },
    });
    if (!existing) return conversation;
    const billingMode = await this.creditService.decideBillingMode(
      conversation.storeId,
    );
    const globalConfig = await getSalesAgentGlobalConfig(this.prisma);
    return this.prisma.$transaction(async (tx) => {
      await tx.salesConversation.update({
        where: { id: conversation.id },
        data: { archivedAt: conversation.archivedAt ?? new Date() },
      });
      return tx.salesConversation.create({
        data: {
          storeId: conversation.storeId,
          customerId: conversation.customerId,
          abVariant: pickVariant(globalConfig.forcedModelVariant),
          voiceVariant: pickVoiceVariant(),
          responseStrategy: pickResponseStrategy(),
          billingMode,
        },
        include: { store: true },
      });
    });
  }

  async handleAction(
    conversation: ConversationWithStore,
    action: SalesAction,
  ): Promise<EngineResult> {
    setLogCtx({ conversationId: conversation.id, storeId: conversation.storeId });
    return this.runActionLocked(conversation, async (fresh) => {
      if (action.type !== 'ADD_TO_CART' && action.type !== 'REORDER') {
        return this.handleActionInner(fresh, action);
      }
      const target = await this.forkConversationIfOrdered(fresh);
      const result = await this.handleActionInner(target, action);
      return target.id === fresh.id
        ? result
        : { ...result, switchedConversationId: target.id };
    });
  }

  private async handleActionInner(
    conversation: ConversationWithStore,
    action: SalesAction,
  ): Promise<EngineResult> {
    // F13: دکمه‌های سبد جمله‌ی قالبی دارند و مدل صدا نمی‌زنند؛ نه «شلوغ است» می‌گیرند نه رزرو نوبت AI.
    // قفل هر مکالمه (runActionLocked) سر جایش می‌ماند، پس دو عملیات سبد هم‌زمان اجرا نمی‌شوند
    if (isButtonCartAction(action)) {
      return this.handleActionTurn(conversation, action).catch((err: unknown) =>
        this.onTurnError(conversation, err),
      );
    }
    if (isLlmSaturated()) return this.saturatedResult(conversation);
    const engine = await resolveEngineMode(conversation.id, conversation.storeId);
    return this.withTurnReservation(conversation, () =>
      runLlmTurn(() => this.handleActionTurn(conversation, action), undefined, { storeId: conversation.storeId, conversationId: conversation.id, engine }).catch(
        (err: unknown) => this.onTurnError(conversation, err),
      ),
    );
  }

  private async handleActionTurn(
    conversation: ConversationWithStore,
    action: SalesAction,
  ): Promise<EngineResult> {
    const blocked = await this.guardStoreAndAi(conversation, null, false);
    if (blocked) return blocked;
    const abuseResult = await this.checkAbuseGuard(conversation);
    if (abuseResult) return abuseResult;

    if (this.billingBlocked(conversation)) {
      return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
    }

    const ctx = this.getContext(conversation);

    // 0.11a — خریدار برگشتی با لینک محصول (استوری اینستاگرام)؛ همان نمایش کارت محصولِ شروع
    // مکالمه (showProduct: کارت + یک خط معرفی قطعی، بدون LLM)
    if (action.type === 'FOCUS_PRODUCT') {
      const product = action.productId
        ? await this.prisma.product.findUnique({
            where: { id: action.productId, ...BUYER_VISIBLE },
            include: PRODUCT_VARIANT_INCLUDE,
          })
        : null;
      if (!product || product.storeId !== conversation.storeId) {
        return this.doClarify(conversation, fa.salesAgent.productNotFound);
      }
      return this.showProduct(conversation, product);
    }

    if (action.type === 'ADD_TO_CART') {
      const product = action.productId
        ? await this.prisma.product.findUnique({
            where: { id: action.productId, ...BUYER_VISIBLE },
            include: PRODUCT_VARIANT_INCLUDE,
          })
        : null;
      if (!product || product.storeId !== conversation.storeId) {
        await this.prisma.conversationEvent.create({
          data: {
            conversationId: conversation.id,
            type: 'CUSTOMER_MESSAGE',
            payload: { text: fa.salesAgent.addToCartAction },
          },
        });
        await touchConversation(this.prisma, conversation.id, 'CUSTOMER');
        return this.doClarify(conversation, fa.salesAgent.productNotFound);
      }
      await this.resolveProductPrices(conversation.storeId, [product]);
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'CUSTOMER_MESSAGE',
          payload: { text: fa.salesAgent.addToCartActionNamed(product.name) },
        },
      });
      await touchConversation(this.prisma, conversation.id, 'CUSTOMER');
      if (action.variantId) {
        const picked = product.variants.find((item) => item.id === action.variantId);
        const optionValues = picked
          ? (picked.optionValues as Record<string, string> | null)
          : null;
        if (!picked || !optionValues || picked.stock < (action.qty ?? 1)) {
          return this.doClarify(conversation, fa.salesAgent.insufficientStock);
        }
        return this.applyCartUpdate(
          conversation,
          ctx,
          product,
          {
            id: picked.id,
            optionValues,
            priceOverride: picked.priceOverride,
            stock: picked.stock,
          },
          action.qty ?? 1,
          false,
          'ADD_TO_CART',
          true,
        );
      }
      // docs/PRD-product-display-focus-and-variations.md §۴.۲ — محصول با گزینه مستقیم به سبد
      // اضافه نمی‌شود، اول باید سایز/رنگ مشخص شود
      if (hasVariantOptions(product)) {
        return this.startVariantSelection(
          conversation,
          ctx,
          product,
          action.qty ?? 1,
        );
      }
      return this.applyCartUpdate(
        conversation,
        ctx,
        product,
        null,
        action.qty ?? 1,
        false,
        'ADD_TO_CART',
        true,
      );
    }

    if (action.type === 'SET_CART_QTY' || action.type === 'REMOVE_CART_ITEM') {
      return this.setCartLine(conversation, ctx, action);
    }

    // docs/PRD-product-display-focus-and-variations.md §۴.۲ — جواب چیپ VARIANT_PROMPT (مسیر
    // دکمه، معادل دکمه‌ای مسیر متنی handleVariantSelectionInput)
    if (action.type === 'SELECT_VARIANT_VALUE') {
      if (!ctx.pendingVariantSelection || !action.value) {
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      }
      return this.resolveVariantSelectionValue(conversation, ctx, action.value);
    }

    // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — جواب دکمه‌ی PAYMENT_METHOD_PROMPT؛
    // addressSnapshot (اگر بوده) قبلاً در pendingOrderAddressSnapshot نگه داشته شده بود
    if (action.type === 'SELECT_PAYMENT_METHOD') {
      if (
        conversation.currentState !== 'PAYMENT_METHOD_SELECTION' ||
        !action.paymentMethod
      ) {
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      }
      return this.applyChosenPaymentMethod(
        conversation,
        ctx,
        action.paymentMethod,
      );
    }

    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ + docs/PRD-buyer-saved-addresses.md
    // — دکمه‌های فلوی ADDRESS_COLLECTION؛ همه فقط وقتی مکالمه واقعاً در همین state است معنا دارند
    if (action.type === 'SELECT_ADDRESS') {
      if (
        conversation.currentState !== 'ADDRESS_COLLECTION' ||
        !action.addressId
      ) {
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      }
      const addr = await this.prisma.customerAddress.findUnique({
        where: { id: action.addressId },
      });
      if (!addr || addr.customerId !== conversation.customerId) {
        return this.doClarify(conversation, fa.salesAgent.addressFlowConfused);
      }
      return this.showAddressConfirm(conversation, ctx, {
        recipientName: addr.recipientName,
        recipientPhone: addr.recipientPhone,
        province: addr.province,
        address: addr.address,
        postalCode: addr.postalCode,
        fromSavedAddressId: addr.id,
      });
    }

    if (action.type === 'NEW_ADDRESS' || action.type === 'EDIT_ADDRESS') {
      if (conversation.currentState !== 'ADDRESS_COLLECTION') {
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      }
      return this.showAddressForm(conversation, ctx);
    }

    if (action.type === 'SUBMIT_ADDRESS') {
      if (conversation.currentState !== 'ADDRESS_COLLECTION') {
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      }
      return this.submitAddressForm(conversation, ctx, action);
    }

    if (action.type === 'SELECT_PROVINCE') {
      if (
        conversation.currentState !== 'ADDRESS_COLLECTION' ||
        ctx.addressStep !== 'province' ||
        !action.province ||
        !IRAN_PROVINCES.includes(action.province)
      ) {
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      }
      return this.advanceAddressStep(
        conversation,
        ctx,
        'address',
        { ...ctx.pendingAddress, province: action.province },
        fa.salesAgent.addressAskFull,
      );
    }

    if (action.type === 'CONFIRM_ADDRESS') {
      if (
        conversation.currentState !== 'ADDRESS_COLLECTION' ||
        ctx.addressStep !== 'confirm' ||
        !ctx.pendingAddress
      ) {
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      }
      return this.handleAddressConfirmed(conversation, ctx);
    }

    if (action.type === 'SAVE_ADDRESS' || action.type === 'SKIP_SAVE_ADDRESS') {
      if (
        conversation.currentState !== 'ADDRESS_COLLECTION' ||
        ctx.addressStep !== 'saveDecision' ||
        !ctx.pendingAddress
      ) {
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      }
      return this.finalizeAfterSaveDecision(
        conversation,
        ctx,
        action.type === 'SAVE_ADDRESS',
      );
    }

    // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۶ (فاز ۴.۸، مورد ۳) — «ذخیره برای بعد»:
    // toggle ساده، بدون تغییر state/سبد؛ از همان endpoint پیام چت دیگر مسیرهای دکمه‌ای رد می‌شود
    if (action.type === 'TOGGLE_SAVE_PRODUCT') {
      const product = action.productId
        ? await this.prisma.product.findUnique({
            where: { id: action.productId, ...BUYER_VISIBLE },
          })
        : null;
      if (!product || product.storeId !== conversation.storeId) {
        return this.doClarify(conversation, fa.salesAgent.productNotFound);
      }
      const existing = await this.prisma.savedProduct.findUnique({
        where: {
          customerId_productId: {
            customerId: conversation.customerId,
            productId: product.id,
          },
        },
      });
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'CUSTOMER_MESSAGE',
          payload: {
            text: existing
              ? fa.salesAgent.unsaveProductActionNamed(product.name)
              : fa.salesAgent.saveProductActionNamed(product.name),
          },
        },
      });
      await touchConversation(this.prisma, conversation.id, 'CUSTOMER');
      if (existing) {
        await this.prisma.savedProduct.delete({ where: { id: existing.id } });
      } else {
        await this.prisma.savedProduct.create({
          data: { customerId: conversation.customerId, productId: product.id },
        });
      }
      const reply = existing
        ? fa.salesAgent.productUnsaved(product.name)
        : fa.salesAgent.productSaved(product.name);
      await this.logReply(conversation, reply, { type: 'NONE' });
      return {
        reply,
        uiBlocks: [{ type: 'NONE' }],
        state: conversation.currentState,
      };
    }

    // همان بخش، مورد ۲ — سفارش‌های قبلی همین Customer (نه فقط همین مکالمه)، تازه‌ترین اول
    if (action.type === 'VIEW_ORDERS') {
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'CUSTOMER_MESSAGE',
          payload: { text: fa.salesAgent.viewOrdersAction },
        },
      });
      await touchConversation(this.prisma, conversation.id, 'CUSTOMER');
      const orders = await this.prisma.order.findMany({
        where: { conversation: { customerId: conversation.customerId } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const uiBlock: UiBlock = {
        type: 'ORDER_LIST',
        orders: orders.map((o) => ({
          id: o.id,
          createdAt: o.createdAt.toISOString(),
          items: o.items as CartItem[],
          totalAmount: o.totalAmount,
          status: o.status,
          orderCode: displayOrderCode(o),
        })),
      };
      const reply = orders.length
        ? await this.caption(
            `سفارش‌های قبلی مشتری: ${orders
              .map(
                (o) =>
                  `${(o.items as CartItem[]).map((i) => i.name).join('، ')} (${o.status})`,
              )
              .join(' | ')}`,
            conversation,
          )
        : fa.salesAgent.noPreviousOrders;
      await this.logReply(conversation, reply, uiBlock, undefined, {
        intent: 'VIEW_ORDERS',
        handler: 'handleAction',
        factsOrPrompt: `${orders.length} سفارش قبلی`,
        model: resolveModel(conversation.abVariant),
      });
      return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
    }

    // همان بخش، مورد ۲ — «دوباره همینو سفارش بده»: آیتم‌های یک سفارش قبلی را به سبد فعلی
    // اضافه می‌کند؛ عیناً از همان computeCartMutation که applyCartUpdate هم استفاده می‌کند
    if (action.type === 'REORDER') {
      const order = action.orderId
        ? await this.prisma.order.findFirst({
            where: {
              id: action.orderId,
              conversation: { customerId: conversation.customerId },
            },
          })
        : null;
      if (!order) {
        return this.doClarify(conversation, fa.salesAgent.reorderNotFound);
      }
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'CUSTOMER_MESSAGE',
          payload: { text: fa.salesAgent.reorderAction },
        },
      });
      await touchConversation(this.prisma, conversation.id, 'CUSTOMER');
      let cart = ctx.cart;
      let anyAdded = false;
      for (const item of order.items as CartItem[]) {
        const product = await this.prisma.product.findUnique({
          where: { id: item.productId, ...BUYER_VISIBLE },
        });
        if (!product || product.storeId !== conversation.storeId) continue;
        await this.resolveProductPrices(conversation.storeId, [product]);
        // docs/PRD-product-display-focus-and-variations.md §۴.۴ — فاز ۱ عمداً دوباره‌سفارش را
        // به سطح واریانت گسترش نمی‌دهد؛ اگر محصول گزینه دارد، همان نسخه‌ی ساده (بدون واریانت
        // خاص) دوباره اضافه می‌شود — مشتری در صورت نیاز از نو گزینه را انتخاب می‌کند
        const mutation = this.computeCartMutation(
          cart,
          product,
          null,
          item.qty,
          false,
        );
        if (mutation.ok) {
          cart = mutation.cart;
          anyAdded = true;
        }
      }
      if (!anyAdded) {
        return this.doClarify(conversation, fa.salesAgent.reorderOutOfStock);
      }
      // فیدبک کاربر ۱۴۰۵/۰۷/۱۶ — همون باگ applyCartUpdate (appliedDiscount نادیده گرفته می‌شد)
      let nextAppliedDiscount = ctx.appliedDiscount;
      let discountNote = '';
      if (ctx.appliedDiscount) {
        const preview = await this.previewDiscount(
          conversation.storeId,
          cart,
          ctx.appliedDiscount.code,
        );
        if (preview.valid) {
          nextAppliedDiscount = {
            id: preview.id,
            code: preview.code,
            amountToman: preview.amountToman,
          };
          discountNote = `\nکد تخفیف ${preview.code} هنوز روی این سبد فعاله — ${preview.amountToman.toLocaleString('fa-IR')} تومان تخفیف، جمع با تخفیف ${preview.newTotal.toLocaleString('fa-IR')} تومان.`;
        } else {
          nextAppliedDiscount = null;
          discountNote = `\n${fa.salesAgent.discountRemovedAfterCartChange}`;
        }
      }
      const nextState: ConversationState = 'CART_REVIEW';
      await this.persistTransition(conversation, nextState, {
        ...ctx,
        cart,
        appliedDiscount: nextAppliedDiscount,
      });
      await this.resetClarifyAttempts(conversation);
      const rawTotal = this.cartTotal(cart);
      const total = nextAppliedDiscount
        ? rawTotal - nextAppliedDiscount.amountToman
        : rawTotal;
      const uiBlock: UiBlock = {
        type: 'CART_SUMMARY',
        items: cart,
        total,
      };
      const facts = `سبد فعلی: ${cart.map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.qty}`).join('، ')} — جمع کل ${rawTotal} تومان${discountNote}`;
      const reply = await this.caption(facts, conversation);
      await this.logReply(conversation, reply, uiBlock, undefined, {
        intent: 'REORDER',
        handler: 'handleAction',
        factsOrPrompt: facts,
        model: resolveModel(conversation.abVariant),
      });
      return { reply, uiBlocks: [uiBlock], state: nextState };
    }

    // CONFIRM_CART
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'CUSTOMER_MESSAGE',
        payload: { text: fa.salesAgent.confirmCartAction },
      },
    });
    await touchConversation(this.prisma, conversation.id, 'CUSTOMER');
    if (conversation.currentState !== 'CART_REVIEW') {
      return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
    }
    return this.doCreateOrder(conversation, ctx);
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۲ — اگر همین Customer (نه همین مکالمه، چون
  // «گفتگوی جدید»/رستارت مکالمه‌ی تازه می‌سازد) قبلاً یک سفارش APPROVED از این فروشگاه داشته،
  // پیام خوش‌آمد اول عوض می‌شود؛ فقط از دیتای موجود (Order)، بدون زیرساخت تازه
  private async buildGreeting(
    conversation: ConversationWithStore,
  ): Promise<string> {
    const previousOrder = await this.prisma.order.findFirst({
      where: {
        status: 'APPROVED',
        conversation: {
          customerId: conversation.customerId,
          id: { not: conversation.id },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const base = (() => {
      if (!previousOrder)
        return fa.salesAgent.firstGreeting(conversation.store.name);
      const items = previousOrder.items as { name: string }[];
      const productName = items[0]?.name;
      if (!productName)
        return fa.salesAgent.firstGreeting(conversation.store.name);
      return fa.salesAgent.returningGreeting(
        conversation.store.name,
        productName,
      );
    })();

    return `${base}${await this.featuredProductPromoSuffix(conversation)}`;
  }

  // docs/PRD-product-display-focus-and-variations.md §۳ — فاز ۲ جایگاه تبلیغاتی: اگر فروشگاه
  // یک محصول را برای نمایش در اولین پیام مکالمه پول داده، همین‌جا به greeting اضافه می‌شود.
  // اگر هم‌زمان چند محصول فعال بود (فروشنده برای چند محصول جداگانه خریده)، فقط آخرین
  // خریدشده نشان داده می‌شود — این یک اسلات تک در هر فروشگاه است، نه رقابت بین چند فروشگاه
  // مثل TELEGRAM_STORE_SEARCH، پس نیازی به چرخش/رتبه‌بندی نیست
  private async featuredProductPromoSuffix(
    conversation: ConversationWithStore,
  ): Promise<string> {
    const active = await this.prisma.adPlacement.findFirst({
      where: {
        storeId: conversation.storeId,
        placement: 'GREETING_FEATURED_PRODUCT',
        status: 'ACTIVE',
        endsAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!active?.productId) return '';
    const product = await this.prisma.product.findUnique({
      where: { id: active.productId, ...BUYER_VISIBLE },
    });
    if (!product) return '';
    // fire-and-forget — طبق تصمیم سند تبلیغات موجود فقط «نشان داده شد» لازم است، تاخیرش
    // نباید جلوی پاسخ به مشتری را بگیرد
    void this.prisma.adPlacement
      .update({
        where: { id: active.id },
        data: { impressionCount: { increment: 1 } },
      })
      .catch(() => undefined);
    return `\n\n${fa.salesAgent.featuredProductPromo(product.name)}`;
  }

  // برای لینک اختصاصی یک محصول (?product=) — دقیقاً مثل doBrowse ولی بدون NLU، چون محصول
  // از قبل مشخص است (سلر لینکش را داده، نه پیام آزاد مشتری). همچنین از handleMessage برای
  // «نگه‌داشتن تمرکز» حین anchor بودن دوباره صدا زده می‌شود — آن‌جا streak فعلی را پاس
  // می‌دهد تا با هر فراخوانی صفر نشود (docs/PRD-product-display-focus-and-variations.md §۲)
  async showProduct(
    conversation: ConversationWithStore,
    product: ProductLike,
    anchorHesitationStreak = 0,
  ): Promise<EngineResult> {
    if (this.billingBlocked(conversation)) {
      return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
    }

    // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲.۳ — در همین‌جا حل
    // می‌شود، نه در هر جای فراخوان‌کننده، چون uiBlock و facts پایین هر دو از همین یک product
    // می‌خوانند (no-op برای محصولات غیرطلا)
    await this.resolveProductPrices(conversation.storeId, [product]);

    const uiBlock: UiBlock = {
      type: 'PRODUCT_CARD',
      products: [
        {
          id: product.id,
          name: product.name,
          basePrice: product.basePrice,
          stock: displayStock(product),
          images: product.images,
          videos: parseProductVideos(product.videos),
          weightGrams: product.weightGrams ?? null,
          purityKarat: product.purityKarat ?? null,
          isWeightBasedPricing: product.pricingModel === 'WEIGHT_BASED_FORMULA',
          goldPricingSummary: product.goldPricingSummary ?? null,
        },
      ],
    };
    const nextState: ConversationState = 'BROWSING';
    await this.persistTransition(conversation, nextState, {
      cart: this.getContext(conversation).cart,
      lastShownProducts: [{ id: product.id, name: product.name }],
      // docs/PRD-product-display-focus-and-variations.md §۲ — مکالمه از لینک اختصاصی همین
      // محصول شروع شده (وب یا تلگرام)؛ تا وقتی مشتری صریح محصول دیگر نخواهد یا تردید نشان
      // ندهد، handleMessage پیام‌های BROWSE عمومی را به همین محصول برمی‌گرداند
      anchoredProductId: product.id,
      anchorHesitationStreak,
    });

    // عمداً بدون عدد موجودی در واقعیت‌هایی که به مدل داده می‌شود — caption() فقط از همین
    // واقعیت‌ها جمله می‌سازد، پس هر عددی اینجا باشد عیناً به مشتری گفته می‌شود. فروشنده
    // نمی‌خواهد تعداد واقعی موجودی افشا شود؛ فقط وضعیت موجود/ناموجود کافی است.
    // docs/PRD-product-display-focus-and-variations.md §۴.۲ — اگر محصول گزینه (سایز/رنگ) دارد،
    // caption از قبل مشتری را آگاه می‌کند که بعد از «افزودن به سبد» باید گزینه انتخاب کند
    const facts = `مشتری از لینک مستقیم این محصول وارد شده: ${product.name} (${product.basePrice} تومان)${displayStock(product) === 0 ? ' — فعلاً ناموجود' : ''}${product.goldPricingSummary ? ` — ${product.goldPricingSummary}` : ''}${hasVariantOptions(product) ? ` — این محصول گزینه‌های مختلف (${product.optionTypes!.map((o) => o.name).join('/')}) دارد${this.describeVariantOptions(product)}` : ''}${product.description ? `\nتوضیحات محصول: ${truncateDescriptionForFacts(product.description, DESCRIPTION_FACTS_SINGLE_MAX_CHARS)}` : ''}${formatSpecsForFacts(parseProductSpecs(product.specs))}${await this.commentsFactsSuffix(product.id)}${await this.crossSellFactsSuffix(conversation.storeId, product.id)}`;
    // skipGreeting=true چون finalReply پایین همیشه (بدون قید isFirstReply) یک buildGreeting
    // جلوی همین reply می‌چسباند — بدون این پرچم، caption() خودش هم یک «سلام!» جدا می‌ساخت
    const reply = await this.caption(facts, conversation, undefined, true);
    const finalReply = `${await this.buildGreeting(conversation)}\n\n${reply}`;
    await this.logReply(conversation, finalReply, uiBlock, undefined, {
      intent: 'BROWSE',
      handler: 'showProduct',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
    return { reply: finalReply, uiBlocks: [uiBlock], state: nextState };
  }

  // برای /start تلگرام (docs/PRD-telegram-bot-channel.md بخش ۴.۱) — همان مسیر BROWSE بدون
  // NLU، دقیقاً معادل اولین پیام «محصولات رو نشون بده» یک مکالمه‌ی تازه
  async startBrowse(
    conversation: ConversationWithStore,
  ): Promise<EngineResult> {
    if (this.billingBlocked(conversation)) {
      return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
    }
    return this.doBrowse(conversation, { intent: 'BROWSE' });
  }

  // docs/PRD-seller-credit-billing.md — وقتی همان لحظه‌ی ساخت مکالمه (startChat وب) معلوم شد
  // BLOCKED است، اولین پاسخ باید مستقیم همین پیام ثابت باشد، نه یک CUSTOMER_MESSAGE ساختگی خالی
  async announceBillingBlocked(
    conversation: ConversationWithStore,
  ): Promise<EngineResult> {
    return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
  }

  private async doBrowse(
    conversation: ConversationWithStore,
    parsed: ParsedIntent,
    customerMessage?: string,
    // docs/PRD-product-display-focus-and-variations.md §۲.۳ — وقتی لنگر محصول به‌خاطر
    // تردید/نارضایتی متوالی برداشته شده، همان محصول از لیست جایگزین‌ها حذف می‌شود تا
    // پیشنهاد واقعاً «محصول دیگر» باشد، نه همان محصولی که مشتری از آن مردد بود
    excludeProductId?: string | null,
  ): Promise<EngineResult> {
    let products = await this.searchProducts(
      conversation.storeId,
      parsed.productQuery,
    );
    if (excludeProductId) {
      products = products.filter((p) => p.id !== excludeProductId);
    }
    if (products.length === 0) {
      // فیدبک کاربر ۱۴۰۵/۰۷/۲۰ — فروشگاه‌های leadCaptureOnly عمداً هیچ محصولی ثبت نمی‌کنند
      // (docs برای همین هدفشان brandIntro/باکس دانش است)؛ پاسخ ثابت «محصولی ثبت نشده» اینجا
      // گمراه‌کننده است، پس به همان مسیر doFaq (که brandIntro و باکس دانش را می‌خواند) ارجاع
      // می‌دهیم. بدون customerMessage (مثلاً startBrowse) چیزی برای جستجو نیست، رفتار قبلی می‌ماند
      if (isNivoLeadStore(conversation.store) && customerMessage) {
        return this.doFaq(
          conversation,
          customerMessage,
          this.getContext(conversation),
        );
      }
      return this.doClarify(conversation, fa.salesAgent.noProductsFound);
    }

    const isFirstReply = conversation.currentState === 'GREETING';

    // همون دلیل showProduct بالا — بدون عدد موجودی در واقعیت‌ها. hasVariantOptions هم همان‌جا
    // توضیح داده شد: فقط یک اشاره‌ی کوتاه که این محصول گزینه دارد، بدون جزئیات
    const facts = `این محصولات فروشگاه است: ${products.map((p) => `${p.name} (${p.basePrice} تومان)${displayStock(p) === 0 ? ' — فعلاً ناموجود' : ''}${goldPricingSummaryOf(p) ? ` — ${goldPricingSummaryOf(p)}` : ''}${hasVariantOptions(p) ? ` — دارای گزینه‌های مختلف (${p.optionTypes.map((o) => o.name).join('/')})${this.describeVariantOptions(p)}` : ''}${p.description ? ` — توضیحات: ${truncateDescriptionForFacts(p.description, descriptionMaxFor(products.length))}` : ''}${formatSpecsForFacts(parseProductSpecs(p.specs))}`).join('، ')}`;

    // docs/PRD-sales-agent-response-strategy-ab.md بخش ۱، جدول Track A — جدول تصمیمی که
    // docs/PRD-sales-agent-implicit-need-detection.md فاز ۱ محاسبه می‌کرد ولی تا امروز هیچ‌جا
    // مصرف نمی‌شد (eval واقعی مورد t6 را نشان داد: pitchReadiness=NEEDS_CLARIFICATION می‌گرفت
    // ولی doBrowse بدون پرسیدن سوال مستقیم یک محصول نشان می‌داد). فقط برای مکالمه‌های
    // responseStrategy=RULE_BASED فعال است — SIMPLE_AGENT تا فاز ۲ (ساخت Track B) رفتار قدیمی
    // را حفظ می‌کند تا مقایسه‌ی دو مسیر منصفانه بماند.
    const useRuleBasedDecisionTable =
      conversation.responseStrategy === 'RULE_BASED';
    if (
      useRuleBasedDecisionTable &&
      parsed.needType &&
      parsed.needType !== 'NONE' &&
      parsed.pitchReadiness === 'NEEDS_CLARIFICATION'
    ) {
      const clarifyText = await this.askClarifyingQuestion(
        facts,
        conversation,
        parsed.implicitNeedSummary ?? customerMessage ?? '',
        isFirstReply,
      );
      const finalClarifyText = isFirstReply
        ? `${await this.buildGreeting(conversation)}\n\n${clarifyText}`
        : clarifyText;
      await this.logReply(
        conversation,
        finalClarifyText,
        { type: 'NONE' },
        undefined,
        {
          intent: parsed.intent,
          handler: 'doBrowse',
          factsOrPrompt: facts,
          model: resolveModel(conversation.abVariant),
        },
      );
      return {
        reply: finalClarifyText,
        uiBlocks: [],
        state: conversation.currentState,
      };
    }
    // Track B — docs/PRD-sales-agent-response-strategy-ab.md بخش ۱. برخلاف Track A، هیچ سیگنال
    // از‌پیش‌محاسبه‌شده‌ای به agent داده نمی‌شود؛ خودش با ابزار تصمیم می‌گیرد سوال بپرسد یا
    // محصول معرفی کند. relevantProductIds خالی یعنی تصمیم گرفت سوال روشن‌کننده بپرسد — هم‌ارز
    // شاخه‌ی CLARIFY بالا، فقط این‌بار خودِ agent تشخیص داده، نه جدول از‌پیش‌نوشته‌شده
    let relevantProducts: { text: string; products: typeof products };
    if (conversation.responseStrategy === 'SIMPLE_AGENT') {
      const { text, relevantProductIds } = await this.agentCaptionWithRelevance(
        facts,
        conversation,
        products.map((p) => p.id),
        customerMessage,
        isFirstReply,
      );
      if (relevantProductIds.length === 0) {
        const finalClarifyText = isFirstReply
          ? `${await this.buildGreeting(conversation)}\n\n${text}`
          : text;
        await this.logReply(
          conversation,
          finalClarifyText,
          { type: 'NONE' },
          undefined,
          {
            intent: parsed.intent,
            handler: 'doBrowse',
            factsOrPrompt: facts,
            model: resolveModel(conversation.abVariant),
          },
        );
        return {
          reply: finalClarifyText,
          uiBlocks: [],
          state: conversation.currentState,
        };
      }
      const filtered = products.filter((p) =>
        relevantProductIds.includes(p.id),
      );
      relevantProducts = {
        text,
        products: filtered.length > 0 ? filtered : products,
      };
    } else {
      // bridgeAndPitch (جدول Track A) — هدف implicit مرتبط با فروشگاه و آماده‌ی پیشنهاد است؛
      // قبل از معرفی محصول، آن هدف تایید و با یک پل علّی کوتاه به محصول وصل می‌شود
      const bridgeNeedSummary =
        useRuleBasedDecisionTable &&
        parsed.needType === 'IMPLICIT' &&
        parsed.storeRelevance === 'RELEVANT' &&
        parsed.pitchReadiness === 'READY'
          ? parsed.implicitNeedSummary
          : null;

      // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — سوال واقعی مشتری (مثلاً «سرفصل‌هاش چیه؟») را هم به caption
      // می‌دهیم تا به‌جای یک معرفی کلی، مستقیم همان سوال را از facts بالا جواب بدهد
      //
      // فیدبک دوم ۱۴۰۵/۰۷/۰۱ — وقتی چند محصول کاندید داریم، باید caption قبل از ساخت uiBlock
      // صدا زده بشه تا بر اساس خودِ پاسخ، فقط محصولات واقعاً مرتبط کارتشون نشون داده بشه (قبلاً
      // uiBlock از روی همه‌ی products ساخته می‌شد، مستقل از اینکه پاسخ متنی فقط یکیشون رو توصیه
      // کرده بود — مثلاً «برای فرانت‌اند React بهتره» ولی کارت دوره‌ی پایتون هم زیرش می‌موند)
      relevantProducts =
        products.length > 1
          ? await (async () => {
              const { text, relevantProductIds } =
                await this.captionWithRelevance(
                  facts,
                  conversation,
                  products.map((p) => p.id),
                  customerMessage,
                  isFirstReply,
                  bridgeNeedSummary,
                );
              const filtered = products.filter((p) =>
                relevantProductIds.includes(p.id),
              );
              return {
                text,
                products: filtered.length > 0 ? filtered : products,
              };
            })()
          : {
              text: await this.caption(
                facts,
                conversation,
                customerMessage,
                isFirstReply,
                bridgeNeedSummary,
              ),
              products,
            };
    }
    // دفاع دوم، مستقل از پرامپت — سقف ۳ محصول نمایشی، حتی اگر مدل با وجود دستور پرامپت
    // بیشتر برگرداند (docs/PRD-product-display-focus-and-variations.md §۱)
    relevantProducts.products = relevantProducts.products.slice(0, 3);

    const uiBlock: UiBlock = {
      type: 'PRODUCT_CARD',
      products: relevantProducts.products.map((p) => ({
        id: p.id,
        name: p.name,
        basePrice: p.basePrice,
        stock: displayStock(p),
        images: p.images,
        videos: parseProductVideos(p.videos),
        weightGrams: p.weightGrams ?? null,
        purityKarat: p.purityKarat ?? null,
        isWeightBasedPricing: p.pricingModel === 'WEIGHT_BASED_FORMULA',
        goldPricingSummary: goldPricingSummaryOf(p),
      })),
    };
    const nextState: ConversationState = 'BROWSING';
    // فیدبک زنده‌ی کاربر ۱۴۰۵/۰۷/۰۹ — وقتی caption خودش جمع کرده روی یک محصول (مثلاً «برای
    // فرانت‌اند React بهتره»)، باید روی همون محصول لنگر بیندازیم؛ وگرنه سوال بعدی مشتری
    // («چیا یادمیگیرم توش؟» بدون اسم صریح محصول) دوباره وارد جستجوی چندمحصولی عادی می‌شود و
    // caption بدون هیچ context‌ای از اینکه کدوم محصول همین الان توصیه شده بود، ممکنه محصول
    // اشتباه رو توضیح بده. فقط وقتی دقیقاً یک محصول باقی مونده anchor می‌کنیم؛ لیست چندتایی
    // هنوز لنگر نمی‌خواد (مشتری هنوز بین گزینه‌ها تصمیم نگرفته)
    const singleNarrowedProduct =
      relevantProducts.products.length === 1
        ? relevantProducts.products[0]
        : null;
    await this.persistTransition(conversation, nextState, {
      cart: this.getContext(conversation).cart,
      lastShownProducts: relevantProducts.products.map((p) => ({
        id: p.id,
        name: p.name,
      })),
      anchoredProductId: singleNarrowedProduct?.id ?? null,
      anchorHesitationStreak: 0,
    });
    await this.resetClarifyAttempts(conversation);

    // فیدبک اول پایلوت: اولین پاسخ مکالمه (بعد از GREETING) یک خط راهنمای ثابت (نه
    // LLM-generated، برای پایداری) جلوی لیست محصولات می‌گیرد — قبلاً مشتری بدون هیچ
    // توضیحی مستقیم می‌رسید به لیست محصولات و نمی‌فهمید چیکار باید بکند
    const finalReply = isFirstReply
      ? `${await this.buildGreeting(conversation)}\n\n${relevantProducts.text}`
      : relevantProducts.text;
    await this.logReply(conversation, finalReply, uiBlock, undefined, {
      intent: parsed.intent,
      handler: 'doBrowse',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
    return { reply: finalReply, uiBlocks: [uiBlock], state: nextState };
  }

  private async doUpdateCart(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    parsed: ParsedIntent,
  ): Promise<EngineResult> {
    if (parsed.intent === 'REMOVE_FROM_CART') {
      if (await this.isCartLocked(conversation)) {
        return this.doClarify(conversation, fa.salesAgent.cartLocked);
      }
    } else if (!['BROWSING', 'CART_REVIEW'].includes(conversation.currentState)) {
      return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
    }

    const ref = this.resolveProductRef(ctx, parsed);
    const product = ref
      ? await this.prisma.product.findUnique({
          where: { id: ref.id, ...BUYER_VISIBLE },
          include: PRODUCT_VARIANT_INCLUDE,
        })
      : parsed.productQuery
        ? (
            await this.searchProducts(conversation.storeId, parsed.productQuery)
          )[0]
        : null;

    if (!product || product.storeId !== conversation.storeId) {
      return this.doClarify(conversation, fa.salesAgent.productNotFound);
    }
    await this.resolveProductPrices(conversation.storeId, [product]);

    // docs/PRD-product-display-focus-and-variations.md §۴.۲ — فاز ۱: پیام آزاد اول («فلان رو
    // می‌خوام») هر نیت واریانتی را که همان پیام حمل کرده باشد نادیده می‌گیرد و همیشه با چیپ
    // صریح می‌پرسد؛ ساده‌تر و بی‌خطاتر از استخراج NLU مقدار از همان جمله
    if (
      parsed.intent === 'ADD_TO_CART' &&
      hasVariantOptions(product) &&
      !ctx.pendingVariantSelection
    ) {
      return this.startVariantSelection(
        conversation,
        ctx,
        product,
        parsed.quantity ?? 1,
      );
    }

    return this.applyCartUpdate(
      conversation,
      ctx,
      product,
      null,
      parsed.quantity ?? 1,
      parsed.intent === 'REMOVE_FROM_CART',
      parsed.intent,
    );
  }

  // محاسبه‌ی خالص (بدون DB) تغییر سبد — docs/PRD-sales-agent-tool-calling-architecture.md
  // بخش ۳.۳ (ابزار update_cart) هم عیناً همین تابع را صدا می‌زند، نه این‌که منطق را تکرار کند.
  // docs/PRD-product-display-focus-and-variations.md §۴ — variant=null یعنی محصول ساده یا
  // (فاز ۱، reorder/tool-calling) واریانت عمداً نادیده گرفته شده
  private computeCartMutation(
    cart: CartItem[],
    product: { id: string; name: string; basePrice: number; stock: number },
    variant: {
      id: string;
      optionValues: Record<string, string>;
      priceOverride: number | null;
      stock: number;
    } | null,
    qty: number,
    remove: boolean,
  ): { ok: true; cart: CartItem[] } | { ok: false } {
    let next = [...cart];

    // حذف همیشه در سطح محصول است، نه واریانت خاص — فاز ۱ وارد تفکیک «کدام واریانت حذف شود»
    // نمی‌شود؛ مشتری در صورت اشتباه دوباره واریانت درست را اضافه می‌کند
    if (remove) {
      next = next.filter((i) => i.productId !== product.id);
      return { ok: true, cart: next };
    }

    // 0.2 — qty نامعتبر (منفی/صفر/اعشاری/بیش از سقف) هرگز به سبد نمی‌رسد
    if (!isValidCartQty(qty)) return { ok: false };
    const availableStock = variant ? variant.stock : product.stock;
    if (availableStock < qty) return { ok: false };
    const unitPrice = variant?.priceOverride ?? product.basePrice;
    const existingIdx = next.findIndex(
      (i) =>
        i.productId === product.id &&
        (i.variantId ?? null) === (variant?.id ?? null),
    );
    if (existingIdx >= 0) {
      const mergedQty = next[existingIdx].qty + qty;
      if (!isValidCartQty(mergedQty) || availableStock < mergedQty)
        return { ok: false };
      next[existingIdx] = {
        ...next[existingIdx],
        qty: mergedQty,
      };
    } else {
      next.push({
        productId: product.id,
        name: product.name,
        unitPrice,
        qty,
        ...(variant
          ? {
              variantId: variant.id,
              variantLabel: Object.entries(variant.optionValues)
                .map(([k, v]) => `${k}: ${v}`)
                .join('، '),
            }
          : {}),
      });
    }
    return { ok: true, cart: next };
  }

  // منطق مشترک تغییر سبد — هم از مسیر NLU (doUpdateCart، productQuery/productIndex حدسی)
  // هم از مسیر قطعی دکمه‌ها (handleAction، productId مستقیم) و هم پایان مسیر واریانت
  // (finalizeVariantSelection) صدا زده می‌شود
  private async assertCartEditable(
    conversation: ConversationWithStore,
  ): Promise<void> {
    if (await this.isCartLocked(conversation)) {
      throw new ConflictException(fa.salesAgent.cartLocked);
    }
  }

  // نسخه‌ی بدون throw: مسیرهای چت/ابزار باید به‌جای ۴۰۹ پیام «سبد قفل است» را برگردانند [R0.5/R0.6]
  private async isCartLocked(
    conversation: ConversationWithStore,
  ): Promise<boolean> {
    const editable =
      conversation.currentState === 'GREETING' ||
      conversation.currentState === 'BROWSING' ||
      conversation.currentState === 'CART_REVIEW';
    if (!editable) return true;
    const existing = await this.prisma.order.findUnique({
      where: { conversationId: conversation.id },
      select: { id: true },
    });
    return !!existing;
  }

  private async replaceLatestCartSummary(
    conversationId: string,
    reply: string,
    uiBlock: UiBlock,
  ): Promise<boolean> {
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId, type: 'AGENT_REPLY' },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { id: true, payload: true },
    });
    const hit = events.find((event) => {
      const payload = event.payload as { uiBlock?: { type?: string } } | null;
      return payload?.uiBlock?.type === 'CART_SUMMARY';
    });
    if (!hit) return false;
    const payload = (hit.payload ?? {}) as Record<string, unknown>;
    await this.prisma.conversationEvent.update({
      where: { id: hit.id },
      data: {
        payload: { ...payload, text: reply, uiBlock } as Prisma.InputJsonValue,
      },
    });
    return true;
  }

  private async setCartLine(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    action: SalesAction,
  ): Promise<EngineResult> {
    await this.assertCartEditable(conversation);
    const productId = action.productId;
    const variantId = action.variantId ?? null;
    if (!productId) return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
    const sameLine = (item: CartItem) =>
      item.productId === productId && (item.variantId ?? null) === variantId;
    const index = ctx.cart.findIndex(sameLine);
    if (index < 0) return this.doClarify(conversation, fa.salesAgent.cartEmpty);
    const line = ctx.cart[index];

    let cart: CartItem[];
    if (action.type === 'SET_CART_QTY') {
      const qty = action.qty ?? 0;
      if (!isValidCartQty(qty)) {
        return this.doClarify(conversation, fa.salesAgent.cartInvalidQty);
      }
      const product = await this.prisma.product.findUnique({
        where: { id: productId, ...BUYER_VISIBLE },
        include: PRODUCT_VARIANT_INCLUDE,
      });
      if (!product || product.storeId !== conversation.storeId) {
        return this.doClarify(conversation, fa.salesAgent.productNotFound);
      }
      await this.resolveProductPrices(conversation.storeId, [product]);
      const variant = variantId
        ? product.variants.find((item) => item.id === variantId) ?? null
        : null;
      if (variantId && !variant) return this.doClarify(conversation, fa.salesAgent.productNotFound);
      const stock = variant ? variant.stock : product.stock;
      if (stock < qty) return this.doClarify(conversation, fa.salesAgent.insufficientStock);
      const unitPrice = variant
        ? (variant.priceOverride ?? product.basePrice)
        : product.basePrice;
      cart = ctx.cart.slice();
      cart[index] = { ...line, qty, unitPrice };
    } else {
      cart = ctx.cart.filter((_, itemIndex) => itemIndex !== index);
    }

    let nextAppliedDiscount = ctx.appliedDiscount;
    let discountNote = '';
    if (ctx.appliedDiscount && cart.length) {
      const preview = await this.previewDiscount(conversation.storeId, cart, ctx.appliedDiscount.code);
      nextAppliedDiscount = preview.valid
        ? { id: preview.id, code: preview.code, amountToman: preview.amountToman }
        : null;
      // B3 — همان خط‌های تخفیف applyCartUpdate، عیناً
      // F12: تخفیف معتبر داخل همان یک خط جمع می‌آید (در قالب)؛ فقط حذف تخفیف خط جدا دارد
      discountNote = preview.valid ? '' : `\n${fa.salesAgent.discountRemovedAfterCartChange}`;
    } else if (!cart.length) {
      nextAppliedDiscount = null;
    }

    await this.persistTransition(conversation, cart.length ? 'CART_REVIEW' : conversation.currentState, {
      ...ctx,
      cart,
      pendingVariantSelection: null,
      appliedDiscount: nextAppliedDiscount,
    });
    const rawTotal = this.cartTotal(cart);
    const total = nextAppliedDiscount ? rawTotal - nextAppliedDiscount.amountToman : rawTotal;
    const uiBlock: UiBlock = { type: 'CART_SUMMARY', items: cart, total };
    // B3 — جمله‌ی قالبی؛ همیشه بدون caption()
    const reply = `${
      !cart.length
        ? fa.salesAgent.cartBtnEmpty
        : action.type === 'SET_CART_QTY'
          ? fa.salesAgent.cartBtnQty(line.name, action.qty ?? line.qty, total, nextAppliedDiscount?.amountToman)
          : fa.salesAgent.cartBtnRemoved(line.name)
    }${discountNote}${await this.cartDiscountHint(conversation, cart.length > 0 && !nextAppliedDiscount && !discountNote)}`;
    const replaced = await this.replaceLatestCartSummary(conversation.id, reply, uiBlock);
    if (!replaced) {
      await this.logReply(conversation, reply, uiBlock, undefined, {
        intent: action.type,
        handler: 'setCartLine',
        factsOrPrompt: reply,
        model: resolveModel(conversation.abVariant),
      });
    }
    return { reply, uiBlocks: [uiBlock], state: cart.length ? 'CART_REVIEW' : conversation.currentState };
  }

  private async applyCartUpdate(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    product: { id: string; name: string; basePrice: number; stock: number },
    variant: {
      id: string;
      optionValues: Record<string, string>;
      priceOverride: number | null;
      stock: number;
    } | null,
    qty: number,
    remove: boolean,
    intent: string,
    // docs/PRD-buyer-chat-redesign.md B3 — true وقتی از «دکمه» (اکشن) آمده؛ جمله‌ی قالبی، بدون caption()
    buttonTemplate = false,
  ): Promise<EngineResult> {
    const mutation = this.computeCartMutation(
      ctx.cart,
      product,
      variant,
      qty,
      remove,
    );
    if (!mutation.ok) {
      return this.doClarify(conversation, fa.salesAgent.insufficientStock);
    }
    const cart = mutation.cart;

    // فیدبک کاربر ۱۴۰۵/۰۷/۱۶ — قبلاً appliedDiscount این‌جا نادیده گرفته می‌شد: بعد از هر
    // تغییر سبد (افزودن/حذف آیتم)، خلاصه همیشه جمع خام را نشان می‌داد و دوباره
    // discountAppliedHint می‌پرسید، انگار هیچ کدی اعمال نشده — حتی اگر لحظاتی قبل کد تخفیف
    // با موفقیت اعمال شده بود. حالا با سبد تازه دوباره اعتبارسنجی می‌شود (previewDiscount):
    // اگر هنوز معتبر است مبلغ/جمع به‌روز می‌شود، اگر نه با پیام صریح حذف می‌شود.
    let nextAppliedDiscount = ctx.appliedDiscount;
    let discountNote = '';
    if (ctx.appliedDiscount) {
      const preview = await this.previewDiscount(
        conversation.storeId,
        cart,
        ctx.appliedDiscount.code,
      );
      if (preview.valid) {
        nextAppliedDiscount = {
          id: preview.id,
          code: preview.code,
          amountToman: preview.amountToman,
        };
        // facts مدل (متن تایپی) عدد فارسی و همان یک خط جمع؛ قالب دکمه خودش تخفیف را در خط جمع می‌گذارد
        discountNote = buttonTemplate
          ? ''
          : `\nکد تخفیف ${preview.code} هنوز روی این سبد فعاله — ${preview.amountToman.toLocaleString('fa-IR')} تومان تخفیف، جمع با تخفیف ${preview.newTotal.toLocaleString('fa-IR')} تومان.`;
      } else {
        nextAppliedDiscount = null;
        discountNote = `\n${fa.salesAgent.discountRemovedAfterCartChange}`;
      }
    }

    const nextState: ConversationState = 'CART_REVIEW';
    // pendingVariantSelection همیشه اینجا پاک می‌شود — چه از مسیر واریانت رسیده باشیم چه نه
    await this.persistTransition(conversation, nextState, {
      ...ctx,
      cart,
      pendingVariantSelection: null,
      appliedDiscount: nextAppliedDiscount,
    });
    await this.resetClarifyAttempts(conversation);

    const rawTotal = this.cartTotal(cart);
    const total = nextAppliedDiscount
      ? rawTotal - nextAppliedDiscount.amountToman
      : rawTotal;
    const uiBlock: UiBlock = {
      type: 'CART_SUMMARY',
      items: cart,
      total,
    };
    const facts = cart.length
      ? `سبد فعلی: ${cart.map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.qty}`).join('، ')} — جمع کل ${rawTotal.toLocaleString('fa-IR')} تومان${discountNote}`
      : fa.salesAgent.cartEmpty;
    const addedLine = cart.find(
      (item) =>
        item.productId === product.id &&
        (item.variantId ?? null) === (variant?.id ?? null),
    );
    const reply = buttonTemplate
      ? `${
          cart.length
            ? fa.salesAgent.cartBtnAdded(
                product.name,
                addedLine?.variantLabel ?? null,
                total,
                nextAppliedDiscount?.amountToman,
              )
            : fa.salesAgent.cartBtnEmpty
        }${discountNote}${await this.cartDiscountHint(conversation, cart.length > 0 && !nextAppliedDiscount && !discountNote)}`
      : await this.caption(facts, conversation);
    await this.logReply(conversation, reply, uiBlock, undefined, {
      intent,
      handler: 'applyCartUpdate',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
    return { reply, uiBlocks: [uiBlock], state: nextState };
  }

  private async doViewCart(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
  ): Promise<EngineResult> {
    // فیدبک کاربر ۱۴۰۵/۰۷/۱۶ — همون باگ applyCartUpdate؛ اینجا سبد تغییر نمی‌کند پس نیازی به
    // اعتبارسنجی دوباره نیست، فقط appliedDiscount موجود باید در total/facts منعکس شود
    const rawTotal = this.cartTotal(ctx.cart);
    const total = ctx.appliedDiscount
      ? rawTotal - ctx.appliedDiscount.amountToman
      : rawTotal;
    const uiBlock: UiBlock = {
      type: 'CART_SUMMARY',
      items: ctx.cart,
      total,
    };
    const facts = ctx.cart.length
      ? `سبد فعلی: ${ctx.cart.map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.qty}`).join('، ')} — جمع کل ${rawTotal.toLocaleString('fa-IR')} تومان${ctx.appliedDiscount ? `\nکد تخفیف ${ctx.appliedDiscount.code} فعاله — ${ctx.appliedDiscount.amountToman.toLocaleString('fa-IR')} تومان تخفیف، جمع با تخفیف ${total.toLocaleString('fa-IR')} تومان.` : ''}`
      : fa.salesAgent.cartEmpty;
    const reply = await this.caption(facts, conversation);
    await this.logReply(conversation, reply, uiBlock, undefined, {
      intent: 'VIEW_CART',
      handler: 'doViewCart',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
    return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
  }

  // docs/PRD-product-display-focus-and-variations.md §۴.۲ — عیناً سبک advanceAddressStep/
  // promptProvinceSelection: متن ثابت (نه caption تولیدی)، چون این یک سوال قالبی‌ست نه نیازمند
  // درک AI. چیپ‌ها خودِ مقادیر را نشان می‌دهند، متن فقط یک خط کوتاه است.
  private optionValuesOf(variant: {
    optionValues: unknown;
  }): Record<string, string> {
    return (variant.optionValues ?? {}) as Record<string, string>;
  }

  private variantLabelOf(variant: { optionValues: unknown }): string {
    return Object.entries(this.optionValuesOf(variant))
      .map(([k, v]) => `${k}: ${v}`)
      .join('، ');
  }

  private firstUnresolvedOptionType(
    product: ProductLike,
    selectedValues: Record<string, string>,
  ): ProductOptionTypeWithValues | null {
    return (
      product.optionTypes?.find((o) => !(o.name in selectedValues)) ?? null
    );
  }

  private buildVariantDimensionPrompt(
    product: ProductLike,
    optionType: ProductOptionTypeWithValues,
    selectedValues: Record<string, string>,
  ): UiBlock {
    return {
      type: 'VARIANT_PROMPT',
      productId: product.id,
      productName: product.name,
      optionName: optionType.name,
      values: optionType.values.map((v) => ({
        label: v.value,
        value: v.value,
      })),
      selectedSoFar: selectedValues,
      mode: 'DIMENSION',
    };
  }

  private buildVariantAlternativesPrompt(
    product: ProductLike,
    alternatives: ProductVariantRow[],
  ): UiBlock {
    return {
      type: 'VARIANT_PROMPT',
      productId: product.id,
      productName: product.name,
      optionName: null,
      values: alternatives.map((v) => ({
        label: this.variantLabelOf(v),
        value: v.id,
      })),
      selectedSoFar: {},
      mode: 'ALTERNATIVES',
    };
  }

  private async prefilledOptionValues(
    conversationId: string,
    product: ProductLike,
  ): Promise<Record<string, string>> {
    try {
      const events = await this.prisma.conversationEvent.findMany({
        where: { conversationId, type: 'CUSTOMER_MESSAGE' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { payload: true },
      });
      const texts = events
        .map((e) => (e.payload as { text?: unknown } | null)?.text)
        .filter((t): t is string => typeof t === 'string');
      return extractOptionValuesFromTexts(product.optionTypes ?? [], texts);
    } catch {
      return {};
    }
  }

  // از handleAction (ADD_TO_CART روی محصول دارای گزینه) و doUpdateCart (مسیر NLU) صدا زده
  // می‌شود — همیشه از بُعد اول (position=0) شروع می‌کند
  private async startVariantSelection(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    product: ProductLike,
    qty: number,
  ): Promise<EngineResult> {
    // QA-15 — مقدارهایی که خریدار قبلاً در همین گفتگو گفته (مثل «۴ ساله»، «رنگ آبیش هست؟»)
    // دوباره پرسیده نمی‌شود؛ فقط بُعدهای مشخص‌نشده چیپ می‌گیرند
    const prefilled = await this.prefilledOptionValues(conversation.id, product);
    const unresolvedType = this.firstUnresolvedOptionType(product, prefilled);
    if (!unresolvedType && Object.keys(prefilled).length > 0) {
      return this.finalizeVariantSelection(
        conversation,
        ctx,
        product,
        { productId: product.id, qty, selectedValues: prefilled, mode: 'DIMENSION' },
        true,
      );
    }
    const firstOptionType = unresolvedType ?? product.optionTypes![0];
    const pendingVariantSelection: PendingVariantSelection = {
      productId: product.id,
      qty,
      selectedValues: unresolvedType ? prefilled : {},
      mode: 'DIMENSION',
    };
    await this.persistTransition(conversation, conversation.currentState, {
      ...ctx,
      pendingVariantSelection,
    });
    const uiBlock = this.buildVariantDimensionPrompt(
      product,
      firstOptionType,
      pendingVariantSelection.selectedValues,
    );
    const reply = fa.salesAgent.variantAskOption(firstOptionType.name);
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
  }

  // docs/PRD-product-display-focus-and-variations.md §۴.۲ — پیام آزاد حین انتخاب واریانت؛
  // فقط mode=DIMENSION را با تطبیق متنی ساده (نه AI) جواب می‌دهد — mode=ALTERNATIVES (ترکیب
  // تمام‌شده) عیناً مثل addressStep='province' فقط با دکمه جلو می‌رود، چون مقدار آن یک
  // شناسه‌ی داخلی (variantId) است، نه چیزی که مشتری واقعاً تایپ کند
  private async handleVariantSelectionInput(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    text: string,
  ): Promise<EngineResult> {
    const pending = ctx.pendingVariantSelection!;
    const product = await this.prisma.product.findUnique({
      where: { id: pending.productId, ...BUYER_VISIBLE },
      include: PRODUCT_VARIANT_INCLUDE,
    });
    if (!product) {
      await this.persistTransition(conversation, conversation.currentState, {
        ...ctx,
        pendingVariantSelection: null,
      });
      return this.doClarify(conversation, fa.salesAgent.productNotFound);
    }
    await this.resolveProductPrices(conversation.storeId, [product]);

    if (pending.mode === 'ALTERNATIVES') {
      const alternatives = product.variants.filter((v) => v.stock > 0);
      const uiBlock = this.buildVariantAlternativesPrompt(
        product,
        alternatives,
      );
      const reply = fa.salesAgent.variantOutOfStockAlternatives;
      await this.logReply(conversation, reply, uiBlock);
      return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
    }

    const optionType = this.firstUnresolvedOptionType(
      product,
      pending.selectedValues,
    );
    if (!optionType) {
      // حالت نامنتظره (selectedValues از قبل کامل بود) — مستقیم نهایی‌سازی را امتحان می‌کنیم
      return this.finalizeVariantSelection(conversation, ctx, product, pending);
    }

    const trimmed = text.trim().toLowerCase();
    const matched = optionType.values.find(
      (v) =>
        v.value.trim().toLowerCase() === trimmed ||
        trimmed.includes(v.value.trim().toLowerCase()),
    );
    if (!matched) {
      const uiBlock = this.buildVariantDimensionPrompt(
        product,
        optionType,
        pending.selectedValues,
      );
      const reply = fa.salesAgent.variantValueNotRecognized(optionType.name);
      await this.logReply(conversation, reply, uiBlock);
      return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
    }

    return this.continueVariantSelection(
      conversation,
      ctx,
      product,
      pending,
      optionType,
      matched.value,
    );
  }

  // جواب چیپ VARIANT_PROMPT از مسیر دکمه (handleAction) — دقیقاً همان مسیر که
  // handleVariantSelectionInput بعد از تطبیق متنی به آن می‌رسد
  private async resolveVariantSelectionValue(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    rawValue: string,
  ): Promise<EngineResult> {
    const pending = ctx.pendingVariantSelection!;
    const product = await this.prisma.product.findUnique({
      where: { id: pending.productId, ...BUYER_VISIBLE },
      include: PRODUCT_VARIANT_INCLUDE,
    });
    if (!product) {
      await this.persistTransition(conversation, conversation.currentState, {
        ...ctx,
        pendingVariantSelection: null,
      });
      return this.doClarify(conversation, fa.salesAgent.productNotFound);
    }
    await this.resolveProductPrices(conversation.storeId, [product]);

    if (pending.mode === 'ALTERNATIVES') {
      const variant = product.variants.find(
        (v) => v.id === rawValue && v.stock > 0,
      );
      if (!variant) {
        // همین الان یکی دیگر خریده بود (race) یا دکمه‌ی قدیمی — لیست موجود را تازه نشان می‌دهیم
        const alternatives = product.variants.filter((v) => v.stock > 0);
        if (alternatives.length === 0) {
          await this.persistTransition(
            conversation,
            conversation.currentState,
            {
              ...ctx,
              pendingVariantSelection: null,
            },
          );
          const reply = fa.salesAgent.variantNoAlternatives;
          await this.logReply(conversation, reply, { type: 'NONE' });
          return {
            reply,
            uiBlocks: [{ type: 'NONE' }],
            state: conversation.currentState,
          };
        }
        const uiBlock = this.buildVariantAlternativesPrompt(
          product,
          alternatives,
        );
        const reply = fa.salesAgent.variantOutOfStockAlternatives;
        await this.logReply(conversation, reply, uiBlock);
        return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
      }
      return this.applyCartUpdate(
        conversation,
        ctx,
        product,
        {
          id: variant.id,
          optionValues: this.optionValuesOf(variant),
          priceOverride: variant.priceOverride,
          stock: variant.stock,
        },
        pending.qty,
        false,
        'ADD_TO_CART',
        true,
      );
    }

    const optionType = this.firstUnresolvedOptionType(
      product,
      pending.selectedValues,
    );
    if (!optionType) {
      return this.finalizeVariantSelection(conversation, ctx, product, pending, true);
    }
    const matched = optionType.values.find((v) => v.value === rawValue);
    if (!matched) {
      const uiBlock = this.buildVariantDimensionPrompt(
        product,
        optionType,
        pending.selectedValues,
      );
      const reply = fa.salesAgent.variantValueNotRecognized(optionType.name);
      await this.logReply(conversation, reply, uiBlock);
      return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
    }
    return this.continueVariantSelection(
      conversation,
      ctx,
      product,
      pending,
      optionType,
      matched.value,
      true,
    );
  }

  // مشترک بین دو مسیر بالا — یک مقدار برای بُعد فعلی تایید شد؛ یا بُعد بعدی را می‌پرسد یا
  // (همه‌ی ابعاد تمام شدند) سعی می‌کند ترکیب را نهایی کند
  private async continueVariantSelection(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    product: ProductLike,
    pending: PendingVariantSelection,
    optionType: ProductOptionTypeWithValues,
    value: string,
    buttonTemplate = false,
  ): Promise<EngineResult> {
    const nextSelectedValues = {
      ...pending.selectedValues,
      [optionType.name]: value,
    };
    const remainingOptionType = this.firstUnresolvedOptionType(
      product,
      nextSelectedValues,
    );
    if (remainingOptionType) {
      const nextPending: PendingVariantSelection = {
        ...pending,
        selectedValues: nextSelectedValues,
      };
      await this.persistTransition(conversation, conversation.currentState, {
        ...ctx,
        pendingVariantSelection: nextPending,
      });
      const uiBlock = this.buildVariantDimensionPrompt(
        product,
        remainingOptionType,
        nextSelectedValues,
      );
      const reply = fa.salesAgent.variantAskOption(remainingOptionType.name);
      await this.logReply(conversation, reply, uiBlock);
      return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
    }
    return this.finalizeVariantSelection(
      conversation,
      ctx,
      product,
      { ...pending, selectedValues: nextSelectedValues },
      buttonTemplate,
    );
  }

  // docs/PRD-product-display-focus-and-variations.md §۴.۳ — همه‌ی ابعاد مشخص شدند؛ یا ترکیب
  // دقیقاً موجود پیدا می‌شود و مستقیم به سبد اضافه می‌شود، یا (موجودی لحظه‌ای تمام‌شده) لیست
  // ترکیب‌های واقعاً موجود نشان داده می‌شود — هرگز حدس یا موجودی فرضی
  private async finalizeVariantSelection(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    product: ProductLike,
    pending: PendingVariantSelection,
    // QA-17 — چیپ/پیش‌پر‌شده از تاریخچه: جمله‌ی قالبی، نه caption() مدل
    buttonTemplate = false,
  ): Promise<EngineResult> {
    const match = product.variants!.find((v) => {
      const values = this.optionValuesOf(v);
      const keys = Object.keys(pending.selectedValues);
      return (
        keys.length === Object.keys(values).length &&
        keys.every((k) => values[k] === pending.selectedValues[k])
      );
    });

    if (match && match.stock > 0) {
      return this.applyCartUpdate(
        conversation,
        ctx,
        product,
        {
          id: match.id,
          optionValues: this.optionValuesOf(match),
          priceOverride: match.priceOverride,
          stock: match.stock,
        },
        pending.qty,
        false,
        'ADD_TO_CART',
        buttonTemplate,
      );
    }

    const alternatives = product.variants!.filter((v) => v.stock > 0);
    if (alternatives.length === 0) {
      await this.persistTransition(conversation, conversation.currentState, {
        ...ctx,
        pendingVariantSelection: null,
      });
      const reply = fa.salesAgent.variantNoAlternatives;
      await this.logReply(conversation, reply, { type: 'NONE' });
      return {
        reply,
        uiBlocks: [{ type: 'NONE' }],
        state: conversation.currentState,
      };
    }
    const alternativesPending: PendingVariantSelection = {
      productId: product.id,
      qty: pending.qty,
      selectedValues: {},
      mode: 'ALTERNATIVES',
    };
    await this.persistTransition(conversation, conversation.currentState, {
      ...ctx,
      pendingVariantSelection: alternativesPending,
    });
    const uiBlock = this.buildVariantAlternativesPrompt(product, alternatives);
    const reply = fa.salesAgent.variantOutOfStockAlternatives;
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
  }

  // F12 — caption() قبلاً برای سبد بدون تخفیف خط discountAppliedHint می‌گرفت؛ در وب همین یادآوری در شیت سبد
  // هست، پس فقط برای تلگرام (که شیت ندارد) به قالب دکمه برمی‌گردد
  private async cartDiscountHint(conversation: ConversationWithStore, wanted: boolean): Promise<string> {
    if (!wanted) return '';
    // یادآوری تزئینی است؛ شکست خواندن کانال نباید جواب دکمه‌ی سبد را خراب کند
    try {
      const channel = await this.orderChannelOf(this.prisma, conversation);
      return channel === 'TELEGRAM' ? `\n${fa.salesAgent.discountAppliedHint}` : '';
    } catch {
      return '';
    }
  }

  // کانال ثبت‌کننده‌ی رویداد سفارش (OrderStatusEvent.channel): تلگرام یا وب
  private async orderChannelOf(
    db: Pick<Prisma.TransactionClient, 'customer'>,
    conversation: ConversationWithStore,
  ): Promise<'TELEGRAM' | 'WEB'> {
    const customer = await db.customer.findUnique({
      where: { id: conversation.customerId },
      select: { channel: true },
    });
    return customer?.channel === 'TELEGRAM' ? 'TELEGRAM' : 'WEB';
  }

  // منطق خالص DB (بدون caption/logReply) — docs/PRD-sales-agent-tool-calling-architecture.md
  // بخش ۳.۳ (ابزار create_order) هم عیناً همین تابع را صدا می‌زند، نه این‌که idempotency/چرخش
  // کارت/کسر اتمیک تخفیف را بازنویسی کند
  private async executeCreateOrder(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    addressSnapshot?: AddressSnapshot,
    // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — فقط وقتی سفارش تازه ساخته
    // می‌شود استفاده می‌شود (پایین‌تر)؛ برای سفارش از قبل موجود، paymentMethod خودِ آن ردیف
    // معتبر است، نه این پارامتر (idempotent reload نباید روش را عوض کند)
    paymentMethod: OrderPaymentMethod = 'CARD_TO_CARD',
  ): Promise<
    | { status: 'empty' }
    | { status: 'test_only' }
    | {
        // 0.2/0.3 — سفارش ساخته نشد: تعداد نامعتبر، موجودی ناکافی یا تغییر قیمت (cart = سبد به‌روز)
        status: 'blocked';
        reason: 'INVALID_QTY' | 'OUT_OF_STOCK' | 'PRICE_CHANGED';
        message: string;
        cart?: CartItem[];
      }
    | { status: 'payment_missing' }
    | {
        status: 'created';
        order: Order;
        paymentMethod: OrderPaymentMethod;
        cardNumber?: string;
        ownerName?: string;
        snapppayLink?: string;
      }
  > {
    if (conversation.isTest) {
      return { status: 'test_only' };
    }
    if (ctx.cart.length === 0) {
      return { status: 'empty' };
    }

    if (
      paymentMethod === 'CARD_TO_CARD' &&
      !(await this.prisma.order.findUnique({
        where: { conversationId: conversation.id },
        select: { id: true },
      })) &&
      !(await this.cardSelector.hasPayableCard(conversation.storeId))
    ) {
      return { status: 'payment_missing' };
    }

    // idempotent: اگر سفارش این مکالمه از قبل هست، همان را برمی‌گرداند (بدون ساخت تکراری)
    let order = await this.prisma.order.findUnique({
      where: { conversationId: conversation.id },
    });
    let cardNumber: string | undefined;
    let ownerName: string | undefined;
    let snapppayLink: string | undefined;
    let card: Awaited<ReturnType<CardSelectorService['selectCard']>> | null =
      null;
    if (!order) {
      // 0.2 — قبل از هر چیز: تعداد هر خط عدد صحیح ۱..سقف (جمع مبلغ سفارش از همین سبد ساخته می‌شود)
      if (ctx.cart.some((i) => !isValidCartQty(i.qty))) {
        return {
          status: 'blocked',
          reason: 'INVALID_QTY',
          message: fa.salesAgent.cartInvalidQty,
        };
      }
      // docs/PRD-customer-comments-and-discounts.md بخش ۹ — فیدبک ۱۴۰۵/۰۷/۱۶: کد تخفیف روی سبد
      // نهایی دوباره اعتبارسنجی می‌شود (read-only)؛ مصرف واقعی پایین‌تر داخل تراکنش است
      const discountPreview = ctx.appliedDiscount
        ? await this.previewDiscount(
            conversation.storeId,
            ctx.cart,
            ctx.appliedDiscount.code,
          )
        : null;

      // 0.3 + 0.4(۴) — خواندن قیمت/موجودی تازه، مصرف کد تخفیف و ساخت سفارش در «یک» تراکنش
      // تعاملی: یا همه با هم یا هیچ. (کد تخفیف قبلاً قبل از order.create مصرف می‌شد و اگر
      // ساخت سفارش fail می‌کرد هدر می‌رفت.)
      let txResult: {
        ok: true;
        order: Order;
        selectedCard: Awaited<ReturnType<CardSelectorService['selectCard']>>;
      } | {
        ok: false;
        rec: ReturnType<typeof reconcileCart>;
      };
      try {
        txResult = await this.prisma.$transaction(async (tx) => {
        const products = await tx.product.findMany({
          where: {
            id: { in: [...new Set(ctx.cart.map((i) => i.productId))] },
            storeId: conversation.storeId,
            ...BUYER_VISIBLE,
          },
          include: PRODUCT_VARIANT_INCLUDE,
        });
        // قیمت طلا و … همان مسیر نمایش/افزودن به سبد را طی می‌کند تا مقایسه هم‌معنا باشد
        await this.resolveProductPrices(conversation.storeId, products);
        const catalog = new Map<string, CatalogLine>();
        for (const item of ctx.cart) {
          const product = products.find((p) => p.id === item.productId);
          if (!product) {
            catalog.set(lineKey(item), null);
            continue;
          }
          if (item.variantId) {
            const v = product.variants.find((x) => x.id === item.variantId);
            catalog.set(
              lineKey(item),
              v
                ? {
                    unitPrice: v.priceOverride ?? product.basePrice,
                    stock: availableQty(product, v),
                  }
                : null,
            );
          } else {
            catalog.set(lineKey(item), {
              unitPrice: product.basePrice,
              stock: availableQty(product, null),
            });
          }
        }
        const rec = reconcileCart(ctx.cart, catalog);
        if (rec.status !== 'OK') return { ok: false as const, rec };

        const cartTotal = this.cartTotal(ctx.cart);
        // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۲.۱ — اگر حداقل
        // یکی از محصولات سفارش تحویل زمان‌بر دارد، کل سفارش hasFulfillmentDelay می‌شود
        const hasFulfillmentDelay = products.some((p) => p.hasFulfillmentDelay);
        // مصرف اتمیک کد تخفیف (UPDATE شرطی خام چون سقف مقایسه‌ی دو ستون همین ردیف است؛ لاک
        // ردیف پستگرس اتمیک‌بودن را تضمین می‌کند)
        let discountAmount = 0;
        let discountCodeId: string | undefined;
        if (discountPreview?.valid) {
          const affected = await tx.$executeRaw`
            UPDATE store_discount_codes
            SET "redemptionCount" = "redemptionCount" + 1
            WHERE id = ${discountPreview.id}
              AND "isActive" = true
              AND ("maxRedemptions" IS NULL OR "redemptionCount" < "maxRedemptions")
          `;
          if (affected > 0) {
            discountAmount = discountPreview.amountToman;
            discountCodeId = discountPreview.id;
          }
        }
        // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ — هزینه‌ی ارسال همین‌جا
        // به مجموع اضافه می‌شود؛ shippingCostToman جدا هم فقط برای شفافیت ذخیره می‌شود
        const total =
          cartTotal -
          discountAmount +
          (addressSnapshot?.shippingCostToman ?? 0);
        // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — انتخاب کارت فقط برای
        // CARD_TO_CARD معنا دارد؛ مسیر SNAPPPAY لینک ثابت فروشگاه است. (بعد از reconcile تا
        // چرخش کارت‌ها با سفارش ردشده جلو نرود)
        const selectedCard =
          paymentMethod === 'CARD_TO_CARD'
            ? await this.cardSelector.selectCard(conversation.storeId)
            : null;
        if (paymentMethod === 'CARD_TO_CARD' && !selectedCard) {
          throw new Error('PAYMENT_METHOD_MISSING');
        }
        // 3.4 — کد سفارش داخل همین تراکنش؛ برخورد با pre-check و retry (۵ بار)
        let orderCode: string | undefined;
        for (let attempt = 0; attempt < ORDER_CODE_MAX_ATTEMPTS; attempt++) {
          const candidate = generateOrderCode();
          const taken = await tx.order.findUnique({
            where: { orderCode: candidate },
            select: { id: true },
          });
          if (!taken) {
            orderCode = candidate;
            break;
          }
        }
        if (!orderCode) {
          this.logger.error(
            `order code collision x${ORDER_CODE_MAX_ATTEMPTS} (store=${conversation.storeId})`,
          );
          throw new Error('ORDER_CODE_GENERATION_FAILED');
        }
        const customerChannel = await this.orderChannelOf(tx, conversation);
        // 3.16 — سیاست مرجوعی لحظه‌ی ثبت؛ تغییر بعدی تنظیم روی این سفارش اثر ندارد
        const policy = await tx.store.findUnique({
          where: { id: conversation.storeId },
          select: {
            returnPolicyMode: true,
            returnWindowDays: true,
            returnShippingPaidBy: true,
          },
        });
        const created = await tx.order.create({
          data: {
            storeId: conversation.storeId,
            conversationId: conversation.id,
            items: ctx.cart,
            totalAmount: total,
            paymentMethod,
            bankCardId: selectedCard?.id,
            discountCodeId,
            hasFulfillmentDelay,
            orderCode,
            // 3.10 — مهلت پرداخت
            paymentDueAt: new Date(
              Date.now() + ORDER_PAYMENT_WINDOW_HOURS * 60 * 60 * 1000,
            ),
            ...(policy ? { returnPolicySnapshot: policy } : {}),
            // 3.3 — اولین رویداد تاریخچه در همان تراکنش
            statusEvents: {
              create: {
                from: null,
                to: 'PENDING_PAYMENT',
                actor: 'BUYER',
                channel: customerChannel,
              },
            },
            ...(addressSnapshot
              ? {
                  recipientName: addressSnapshot.recipientName,
                  recipientPhone: addressSnapshot.recipientPhone,
                  shippingProvince: addressSnapshot.province,
                  shippingAddress: addressSnapshot.address,
                  postalCode: addressSnapshot.postalCode ?? undefined,
                  addressId: addressSnapshot.addressId ?? undefined,
                  shippingCostToman: addressSnapshot.shippingCostToman,
                }
              : {}),
          },
        });
        return { ok: true as const, order: created, selectedCard };
      });
      } catch (err) {
        if (err instanceof Error && err.message === 'PAYMENT_METHOD_MISSING') {
          return { status: 'payment_missing' };
        }
        throw err;
      }

      if (!txResult.ok) {
        const rec = txResult.rec;
        if (rec.status === 'OUT_OF_STOCK') {
          return {
            status: 'blocked',
            reason: 'OUT_OF_STOCK',
            message: fa.salesAgent.orderOutOfStock(rec.shortages),
          };
        }
        if (rec.status === 'PRICE_CHANGED') {
          // سبد به‌روز می‌شود و منتظر تایید مجدد خریدار می‌مانیم (سفارش با قیمت قدیمی ساخته نشد)
          const nextCtx: ConversationContext = {
            ...ctx,
            cart: rec.cart,
            appliedDiscount: null,
          };
          await this.persistTransition(conversation, 'CART_REVIEW', nextCtx);
          return {
            status: 'blocked',
            reason: 'PRICE_CHANGED',
            message: fa.salesAgent.orderPriceChanged(rec.changes),
            cart: rec.cart,
          };
        }
        return {
          status: 'blocked',
          reason: 'INVALID_QTY',
          message: fa.salesAgent.cartInvalidQty,
        };
      }
      order = txResult.order;
      card = txResult.selectedCard;
      // 3.6/3.7 — ORDER_PLACED (SMS؛ بهترین تلاش و غیرمسدودکننده)
      void this.orderNotifications
        .onPlaced(order)
        .catch((err) =>
          this.logger.error(
            `ORDER_PLACED notify failed (order=${order!.id})`,
            err,
          ),
        );
      if (card) {
        cardNumber = card.cardNumber;
        ownerName = card.ownerName;
      } else {
        // بخش ۵ — لینک ثابت فروشگاه (در دسترس‌بودنش قبل از رسیدن به اینجا در finalizeOrder
        // چک شده؛ هرگز نباید نال باشد، ولی دفاعی رشته‌ی خالی به‌جای کرش)
        snapppayLink = conversation.store.snapppayPaymentLink ?? '';
      }
    } else if (order.paymentMethod === 'SNAPPPAY') {
      snapppayLink = conversation.store.snapppayPaymentLink ?? '';
    } else if (order.bankCardId) {
      const card = await this.prisma.storeBankCard.findUnique({
        where: { id: order.bankCardId },
      });
      // bankCardNumber/bankOwnerName فقط برای فروشگاه REGION=INTL می‌تواند نال باشد
      // (docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳)؛ آن فروشگاه‌ها چک‌اوت/Order
      // ندارند پس به این مسیر هرگز نمی‌رسند — برای فروشگاه ایرانی همیشه از DTO ثبت‌نام ست شده
      cardNumber = card?.cardNumber ?? conversation.store.bankCardNumber!;
      ownerName = card?.ownerName ?? conversation.store.bankOwnerName!;
    } else {
      cardNumber = conversation.store.bankCardNumber!;
      ownerName = conversation.store.bankOwnerName!;
    }
    if (conversation.store.isDemo) {
      cardNumber = DEMO_FAKE_CARD_NUMBER;
      ownerName = DEMO_FAKE_CARD_OWNER;
      snapppayLink = '';
    }

    const nextState: ConversationState = 'AWAITING_PAYMENT';
    await this.persistTransition(conversation, nextState, ctx, 'createOrder');
    if (conversation.store.isDemo) {
      this.productEvents.log(
        'demo_order_placed',
        { storeId: conversation.storeId, conversationId: conversation.id },
        { category: conversation.store.category },
      );
    }

    return {
      status: 'created',
      order,
      paymentMethod: order.paymentMethod,
      cardNumber,
      ownerName,
      snapppayLink,
    };
  }

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ — فقط وقتی فروشگاه ارسال دارد
  // وارد ADDRESS_COLLECTION می‌شویم؛ وگرنه (فروش حضوری/دیجیتال) مستقیم همان فلوی قدیمی
  private async doCreateOrder(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
  ): Promise<EngineResult> {
    if (ctx.cart.length === 0) {
      return this.doClarify(conversation, fa.salesAgent.cartEmpty);
    }
    if (conversation.store.requiresShipping) {
      return this.beginAddressCollection(conversation, ctx);
    }
    return this.finalizeOrder(conversation, ctx);
  }

  // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — کارت‌به‌کارت تقریباً همیشه در
  // دسترس است (فروشگاه ایرانی بدون آن اصلاً به این مرحله نمی‌رسد)؛ تنها شرط واقعی، فعال‌بودن
  // لینک اسنپ‌پی فروشگاه است. وقتی هر دو در دسترس باشند، خریدار باید انتخاب کند
  private snapppayAvailable(store: ConversationWithStore['store']): boolean {
    return !store.isDemo && !!store.snapppayPaymentLink;
  }

  // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — جواب PAYMENT_METHOD_SELECTION،
  // چه از دکمه (handleAction's SELECT_PAYMENT_METHOD) چه از متن آزاد
  // (handlePaymentMethodSelectionInput پایین) بیاید؛ addressSnapshot‌ای که قبلاً در ctx نگه
  // داشته شده بود را بیرون می‌کشد و finalizeOrder را با روش قطعی‌شده صدا می‌زند
  private async applyChosenPaymentMethod(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    method: OrderPaymentMethod,
  ): Promise<EngineResult> {
    const addressSnapshot = ctx.pendingOrderAddressSnapshot ?? undefined;
    return this.finalizeOrder(
      conversation,
      { ...ctx, pendingOrderAddressSnapshot: null },
      addressSnapshot,
      method,
    );
  }

  // عیناً الگوی handleVariantSelectionInput/handleAddressInput — پیام آزاد حین
  // PAYMENT_METHOD_SELECTION هم باید جواب بدهد، نه فقط کلیک دکمه (خیلی از خریدارها به‌جای
  // زدن دکمه تایپ می‌کنند). تطبیق کلیدواژه‌ی ساده کافی است، نیازی به فراخوان AI نیست
  private async handlePaymentMethodSelectionInput(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    text: string,
  ): Promise<EngineResult> {
    const wantsSnapppay = /اسنپ|snap/i.test(text);
    const wantsCard = /کارت|card/i.test(text);
    if (wantsSnapppay === wantsCard) {
      // یا هیچ‌کدام تشخیص داده نشد یا هر دو با هم — دوباره همان سوال با دکمه‌ها
      const uiBlock: UiBlock = {
        type: 'PAYMENT_METHOD_PROMPT',
        options: ['CARD_TO_CARD', 'SNAPPPAY'],
      };
      const reply = fa.salesAgent.choosePaymentMethodPrompt;
      await this.logReply(conversation, reply, uiBlock);
      return {
        reply,
        uiBlocks: [uiBlock],
        state: conversation.currentState,
      };
    }
    return this.applyChosenPaymentMethod(
      conversation,
      ctx,
      wantsSnapppay ? 'SNAPPPAY' : 'CARD_TO_CARD',
    );
  }

  private async previewTestCheckout(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    paymentMethod: OrderPaymentMethod,
    addressSnapshot?: AddressSnapshot,
  ): Promise<EngineResult> {
    const amount =
      this.cartTotal(ctx.cart) + (addressSnapshot?.shippingCostToman ?? 0);
    const text = fa.salesAgent.testChatNoRealOrder;
    let uiBlock: UiBlock = { type: 'NONE' };
    if (paymentMethod === 'SNAPPPAY') {
      uiBlock = {
        type: 'SNAPPPAY_PAYMENT_INSTRUCTIONS',
        link: conversation.store.snapppayPaymentLink ?? '',
        amount,
      };
    } else {
      const card = await this.cardSelector.selectCard(conversation.storeId);
      if (card) {
        uiBlock = {
          type: 'PAYMENT_INSTRUCTIONS',
          cardNumber: card.cardNumber,
          ownerName: card.ownerName,
          amount,
        };
      }
    }
    await this.logReply(conversation, text, uiBlock);
    return {
      reply: text,
      uiBlocks: uiBlock.type === 'NONE' ? [] : [uiBlock],
      state: conversation.currentState,
    };
  }

  // قبلاً تمام بدنه‌ی doCreateOrder همین بود؛ استخراج شد تا هم از مسیر بدون‌آدرس بالا هم از
  // انتهای فلوی ADDRESS_COLLECTION (finalizeAddressOrder) صدا زده شود. forcedPaymentMethod
  // فقط از handleAction's SELECT_PAYMENT_METHOD پاس داده می‌شود — یعنی خریدار قبلاً انتخاب
  // کرده و دیگر نیازی به سوال نیست (docs/PRD-buyer-payment-method-card-or-snapppay-link.md)
  private async finalizeOrder(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    addressSnapshot?: AddressSnapshot,
    forcedPaymentMethod?: OrderPaymentMethod,
  ): Promise<EngineResult> {
    let paymentMethod = forcedPaymentMethod;
    if (!paymentMethod) {
      // executeCreateOrder پایین‌تر خودش idempotent است (اگر سفارش این مکالمه از قبل هست،
      // دوباره نمی‌سازد)؛ ولی تصمیم «سوال بپرس یا نه» باید از همین الان هم idempotent باشد —
      // وگرنه فراخوانی دوباره‌ی finalizeOrder برای یک مکالمه با سفارش از قبل موجود (مثلاً
      // دوبار کلیک تایید آدرس) دوباره سوال روش پرداخت را می‌پرسد، درحالی‌که سفارش از قبل
      // یک روش قطعی دارد
      const existingOrder = await this.prisma.order.findUnique({
        where: { conversationId: conversation.id },
      });
      if (existingOrder) {
        paymentMethod = existingOrder.paymentMethod;
      } else if (
        this.snapppayAvailable(conversation.store) &&
        (await this.cardSelector.hasPayableCard(conversation.storeId))
      ) {
        // هر دو روش فعال‌اند — عیناً الگوی ADDRESS_PROMPT CHOOSE_SAVED: خودِ Order هنوز ساخته
        // نمی‌شود، snapshot آدرس تا جواب برسد در ctx می‌ماند
        const nextCtx: ConversationContext = {
          ...ctx,
          pendingOrderAddressSnapshot: addressSnapshot ?? null,
        };
        await this.persistTransition(
          conversation,
          'PAYMENT_METHOD_SELECTION',
          nextCtx,
        );
        const uiBlock: UiBlock = {
          type: 'PAYMENT_METHOD_PROMPT',
          options: ['CARD_TO_CARD', 'SNAPPPAY'],
        };
        const reply = fa.salesAgent.choosePaymentMethodPrompt;
        await this.logReply(conversation, reply, uiBlock);
        return {
          reply,
          uiBlocks: [uiBlock],
          state: 'PAYMENT_METHOD_SELECTION',
        };
      }
    }
    if (
      !paymentMethod &&
      this.snapppayAvailable(conversation.store) &&
      !(await this.cardSelector.hasPayableCard(conversation.storeId))
    ) {
      paymentMethod = 'SNAPPPAY';
    }
    paymentMethod = paymentMethod ?? 'CARD_TO_CARD';

    const created = await this.executeCreateOrder(
      conversation,
      ctx,
      addressSnapshot,
      paymentMethod,
    );
    if (created.status === 'test_only') {
      return this.previewTestCheckout(
        conversation,
        ctx,
        paymentMethod,
        addressSnapshot,
      );
    }
    if (created.status === 'empty') {
      return this.doClarify(conversation, fa.salesAgent.cartEmpty);
    }
    if (created.status === 'payment_missing') {
      return this.paymentMethodMissing(conversation);
    }
    if (created.status === 'blocked') {
      // پیام ثابت (بدون caption تولیدی)؛ برای تغییر قیمت، خلاصه‌ی سبد به‌روز هم نشان داده می‌شود
      const uiBlocks: UiBlock[] = created.cart
        ? [
            {
              type: 'CART_SUMMARY',
              items: created.cart,
              total: this.cartTotal(created.cart),
            },
          ]
        : [];
      await this.logReply(conversation, created.message, uiBlocks[0]);
      return {
        reply: created.message,
        uiBlocks,
        state:
          created.reason === 'PRICE_CHANGED'
            ? 'CART_REVIEW'
            : conversation.currentState,
      };
    }

    const shippingLine = addressSnapshot?.shippingCostToman
      ? ` (شامل ${addressSnapshot.shippingCostToman.toLocaleString('fa-IR')} تومان هزینه ارسال)`
      : '';
    const uiBlock: UiBlock =
      created.paymentMethod === 'SNAPPPAY'
        ? {
            type: 'SNAPPPAY_PAYMENT_INSTRUCTIONS',
            link: created.snapppayLink!,
            amount: created.order.totalAmount,
            orderCode: displayOrderCode(created.order),
            dueAt: created.order.paymentDueAt?.toISOString(),
          }
        : {
            type: 'PAYMENT_INSTRUCTIONS',
            cardNumber: created.cardNumber!,
            ownerName: created.ownerName!,
            amount: created.order.totalAmount,
            orderCode: displayOrderCode(created.order),
            dueAt: created.order.paymentDueAt?.toISOString(),
          };
    // docs/PRD-buyer-payment-method-card-or-snapppay-link.md بخش ۳ — لینک اسنپ‌پی ثابت و
    // بدون callback است؛ چون نیوو هیچ راه خودکاری برای تطبیق مقصد پرداخت ندارد، هم اسکرین‌شات
    // هم کد رهگیری (که اسنپ‌پی خودش بعد از پرداخت به خریدار می‌دهد) الزامی است
    const facts =
      created.paymentMethod === 'SNAPPPAY'
        ? `سفارش ثبت شد. مبلغ قابل پرداخت ${created.order.totalAmount} تومان${shippingLine} از طریق این لینک اسنپ‌پی: ${created.snapppayLink}. بعد از پرداخت، هم کد رهگیری‌ای که اسنپ‌پی نشان می‌دهد و هم اسکرین‌شات صفحه‌ی موفقیت پرداخت را بفرست.`
        : `سفارش ثبت شد. مبلغ قابل پرداخت ${created.order.totalAmount} تومان${shippingLine} به شماره کارت ${created.cardNumber} به نام ${created.ownerName}. بعد از واریز، عکس رسید را بفرست.`;
    const reply = await this.caption(facts, conversation);
    await this.logReply(conversation, reply, uiBlock, undefined, {
      intent: 'CHECKOUT',
      handler: 'doCreateOrder',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
    return { reply, uiBlocks: [uiBlock], state: 'AWAITING_PAYMENT' };
  }

  // docs/PRD-buyer-saved-addresses.md بخش ۳ — حداکثر ۳ آدرس اخیر + «آدرس جدید»؛ اگر خریدار
  // هیچ آدرسی ندارد، مستقیم اولین سوال (اسم گیرنده) پرسیده می‌شود
  private async showAddressForm(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    checked?: AddressFormResult,
  ): Promise<EngineResult> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: conversation.customerId },
      select: { phone: true, fullName: true },
    });
    const nextCtx: ConversationContext = {
      ...ctx,
      addressStep: 'form',
      pendingAddress: ctx.pendingAddress?.fromSavedAddressId ? null : ctx.pendingAddress,
    };
    await this.persistTransition(conversation, 'ADDRESS_COLLECTION', nextCtx);
    const uiBlock: UiBlock = {
      type: 'ADDRESS_PROMPT',
      mode: 'FORM',
      provinces: [...IRAN_PROVINCES],
      prefillName:
        checked?.values.recipientName ||
        ctx.pendingAddress?.recipientName ||
        customer?.fullName ||
        undefined,
      prefillPhone:
        checked?.values.recipientPhone ||
        ctx.pendingAddress?.recipientPhone ||
        customer?.phone ||
        undefined,
      fieldErrors: checked && !checked.ok ? checked.errors : undefined,
      values: checked?.values,
    };
    const reply = fa.salesAgent.addressFormPrompt;
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: 'ADDRESS_COLLECTION' };
  }

  private async submitAddressForm(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    action: SalesAction,
  ): Promise<EngineResult> {
    const checked = validateAddressForm(action);
    if (!checked.ok || !checked.phone || !checked.postal) {
      return this.showAddressForm(conversation, ctx, checked);
    }
    const { recipientName, province, city, addressText, plaque, unit } = checked.values;
    const address = [
      city,
      addressText,
      plaque ? `پلاک ${plaque}` : '',
      unit ? `واحد ${unit}` : '',
    ].filter(Boolean).join('، ');
    return this.showAddressConfirm(conversation, ctx, {
      recipientName,
      recipientPhone: checked.phone,
      province,
      address,
      postalCode: checked.postal,
    });
  }

  private async beginAddressCollection(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
  ): Promise<EngineResult> {
    const addresses = await this.prisma.customerAddress.findMany({
      where: { customerId: conversation.customerId },
      orderBy: { lastUsedAt: 'desc' },
      take: 3,
    });

    if (addresses.length === 0) {
      return this.showAddressForm(conversation, ctx);
    }

    const nextCtx: ConversationContext = {
      ...ctx,
      addressStep: 'choose',
      pendingAddress: null,
    };
    await this.persistTransition(conversation, 'ADDRESS_COLLECTION', nextCtx);
    const uiBlock: UiBlock = {
      type: 'ADDRESS_PROMPT',
      mode: 'CHOOSE_SAVED',
      addresses: addresses.map((a) => ({
        id: a.id,
        summary: fa.salesAgent.savedAddressSummary(
          a.recipientName,
          a.province,
          a.address,
          a.lastUsedAt,
        ),
      })),
    };
    const reply = fa.salesAgent.addressChooseSavedPrompt;
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: 'ADDRESS_COLLECTION' };
  }

  // یک گام جلو می‌رود: ctx را آپدیت/پرسیست می‌کند و سوال بعدی را بدون فراخوان AI برمی‌گرداند
  // (دقیقاً مثل doCancel/resetCartState — پیام‌های ثابت فلوی چک‌اوت هیچ‌وقت caption تولیدی ندارند)
  private async advanceAddressStep(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    nextStep: NonNullable<ConversationContext['addressStep']>,
    pendingAddress: NonNullable<ConversationContext['pendingAddress']>,
    reply: string,
  ): Promise<EngineResult> {
    const nextCtx: ConversationContext = {
      ...ctx,
      addressStep: nextStep,
      pendingAddress,
    };
    await this.persistTransition(conversation, 'ADDRESS_COLLECTION', nextCtx);
    await this.logReply(conversation, reply, { type: 'NONE' });
    return { reply, uiBlocks: [{ type: 'NONE' }], state: 'ADDRESS_COLLECTION' };
  }

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — برخلاف
  // advanceAddressStep (سوال متنی ساده)، این گام همیشه یک دکمه‌چین از ۳۱ استان برمی‌گرداند؛
  // reply قابل‌تغییر است تا هم سوال اول هم یادآوری «از دکمه انتخاب کن» از همین عبور کنند
  private async promptProvinceSelection(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    pendingAddress: NonNullable<ConversationContext['pendingAddress']>,
    reply: string = fa.salesAgent.addressAskProvince,
  ): Promise<EngineResult> {
    const nextCtx: ConversationContext = {
      ...ctx,
      addressStep: 'province',
      pendingAddress,
    };
    await this.persistTransition(conversation, 'ADDRESS_COLLECTION', nextCtx);
    const uiBlock: UiBlock = {
      type: 'ADDRESS_PROMPT',
      mode: 'CHOOSE_PROVINCE',
      provinces: [...IRAN_PROVINCES],
    };
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: 'ADDRESS_COLLECTION' };
  }

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ — پیام‌های آزاد مشتری حین
  // ADDRESS_COLLECTION هیچ‌وقت از parseIntent رد نمی‌شوند (دقیقاً مثل awaitingReview در
  // handleMessage)؛ یک state machine ساده و قطعی روی ctx.addressStep، نه NLU
  private async handleAddressInput(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    text: string,
  ): Promise<EngineResult> {
    const pending = ctx.pendingAddress ?? {};
    const trimmed = text.trim();

    switch (ctx.addressStep) {
      case 'form':
        return this.showAddressForm(conversation, ctx);
      case 'name':
        if (!trimmed) {
          return this.doClarify(conversation, fa.salesAgent.addressAskName);
        }
        return this.advanceAddressStep(
          conversation,
          ctx,
          'phone',
          { ...pending, recipientName: trimmed },
          fa.salesAgent.addressAskPhone,
        );
      case 'phone': {
        const phone = normalizeIranMobile(trimmed);
        if (!phone) {
          return this.doClarify(
            conversation,
            fa.salesAgent.addressPhoneInvalid,
          );
        }
        return this.promptProvinceSelection(conversation, ctx, {
          ...pending,
          recipientPhone: phone,
        });
      }
      case 'province':
        // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — این گام فقط
        // با دکمه (SELECT_PROVINCE در handleAction) جلو می‌رود، نه تایپ آزاد؛ اگر مشتری متن
        // فرستاد، همان چوزر دوباره با یک یادآوری نشان داده می‌شود
        return this.promptProvinceSelection(
          conversation,
          ctx,
          pending,
          fa.salesAgent.addressProvinceUseButtons,
        );
      case 'address':
        if (!trimmed) {
          return this.doClarify(conversation, fa.salesAgent.addressAskFull);
        }
        return this.advanceAddressStep(
          conversation,
          ctx,
          'postal',
          { ...pending, address: trimmed },
          fa.salesAgent.addressAskPostal,
        );
      case 'postal': {
        const skip = /^(ندارم|نداره|نه|skip|-|ندارد)$/i.test(trimmed);
        return this.showAddressConfirm(conversation, ctx, {
          ...pending,
          postalCode: skip ? null : trimmed,
        });
      }
      default:
        // حالت نامنتظره (مثلاً مرورگر/تلگرام دوباره یک پیام قدیمی فرستاده) — از اول شروع می‌کنیم
        return this.beginAddressCollection(conversation, ctx);
    }
  }

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ — همیشه یک تایید نهایی قبل از
  // نهایی‌شدن (هم برای آدرس تازه هم آدرس ذخیره‌شده‌ی انتخاب‌شده)؛ اگر استان پوشش ارسال ندارد،
  // فلو مسدود می‌شود — صادقانه گفته می‌شود و دوباره انتخاب استان خواسته می‌شود، سفارش ثبت نمی‌شود
  // مگر خریدار استان دیگری انتخاب کند (فیدبک کاربر ۱۴۰۵/۰۷/۱۳)
  private async showAddressConfirm(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    pending: NonNullable<ConversationContext['pendingAddress']>,
  ): Promise<EngineResult> {
    const province = pending.province ?? '';
    const { cost, covered } = await this.getShippingCost(
      conversation.storeId,
      province,
    );

    if (!covered) {
      return this.promptProvinceSelection(
        conversation,
        ctx,
        { ...pending, province: undefined },
        fa.salesAgent.provinceNotCoveredWarning(province),
      );
    }

    const nextCtx: ConversationContext = {
      ...ctx,
      addressStep: 'confirm',
      pendingAddress: pending,
    };
    await this.persistTransition(conversation, 'ADDRESS_COLLECTION', nextCtx);

    const summary = fa.salesAgent.addressFullSummary(
      pending.recipientName ?? '',
      pending.recipientPhone ?? '',
      province,
      pending.address ?? '',
      pending.postalCode ?? null,
      cost,
    );
    const uiBlock: UiBlock = {
      type: 'ADDRESS_PROMPT',
      mode: 'CONFIRM',
      summary,
      shippingCostToman: cost,
      provinceCovered: covered,
    };
    const reply = fa.salesAgent.addressConfirmQuestion;
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: 'ADDRESS_COLLECTION' };
  }

  // از handleAction (دکمه‌ی CONFIRM_ADDRESS) صدا زده می‌شود. آدرس ذخیره‌شده: فقط lastUsedAt
  // آپدیت و مستقیم نهایی می‌شود. آدرس تازه: قبل از نهایی‌شدن سوال «ذخیره کنم؟» پرسیده می‌شود
  // (بخش ۳.۳ سند)
  private async handleAddressConfirmed(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
  ): Promise<EngineResult> {
    const pending = ctx.pendingAddress as NonNullable<
      ConversationContext['pendingAddress']
    >;
    if (pending.fromSavedAddressId) {
      await this.prisma.customerAddress.update({
        where: { id: pending.fromSavedAddressId },
        data: { lastUsedAt: new Date() },
      });
      return this.finalizeAddressOrder(
        conversation,
        ctx,
        pending,
        pending.fromSavedAddressId,
      );
    }
    const nextCtx: ConversationContext = {
      ...ctx,
      addressStep: 'saveDecision',
    };
    await this.persistTransition(conversation, 'ADDRESS_COLLECTION', nextCtx);
    const uiBlock: UiBlock = { type: 'ADDRESS_PROMPT', mode: 'ASK_SAVE' };
    const reply = fa.salesAgent.addressSavePrompt;
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: 'ADDRESS_COLLECTION' };
  }

  // docs/PRD-buyer-saved-addresses.md بخش ۳.۳ — سقف نرم ۱۰ آدرس به‌ازای هر Customer؛ اگر رد
  // شد، سفارش همچنان ثبت می‌شود (فقط آدرس تازه ذخیره نمی‌شود) — تجربه‌ی خرید را مسدود نمی‌کند
  private async finalizeAfterSaveDecision(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    save: boolean,
  ): Promise<EngineResult> {
    const pending = ctx.pendingAddress as NonNullable<
      ConversationContext['pendingAddress']
    >;
    let addressId: string | null = null;
    if (save) {
      const existingCount = await this.prisma.customerAddress.count({
        where: { customerId: conversation.customerId },
      });
      if (existingCount < 10) {
        const created = await this.prisma.customerAddress.create({
          data: {
            customerId: conversation.customerId,
            recipientName: pending.recipientName ?? '',
            recipientPhone: pending.recipientPhone ?? '',
            province: pending.province ?? '',
            address: pending.address ?? '',
            postalCode: pending.postalCode ?? undefined,
            isDefault: existingCount === 0,
          },
        });
        addressId = created.id;
      }
    }
    return this.finalizeAddressOrder(conversation, ctx, pending, addressId);
  }

  private async finalizeAddressOrder(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    pending: NonNullable<ConversationContext['pendingAddress']>,
    addressId: string | null,
  ): Promise<EngineResult> {
    const province = pending.province ?? '';
    const { cost } = await this.getShippingCost(conversation.storeId, province);
    const clearedCtx: ConversationContext = {
      ...ctx,
      addressStep: undefined,
      pendingAddress: null,
    };
    return this.finalizeOrder(conversation, clearedCtx, {
      recipientName: pending.recipientName ?? '',
      recipientPhone: pending.recipientPhone ?? '',
      province,
      address: pending.address ?? '',
      postalCode: pending.postalCode ?? null,
      addressId,
      shippingCostToman: cost,
    });
  }

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — اگر فروشنده هنوز
  // هیچ StoreShippingRule تعریف نکرده (نه ردیف استان خاص نه پیش‌فرض کل ایران)، رایگان/بدون‌مانع
  // فرض می‌شود؛ فروشگاه‌های قدیمی‌تر که تازه requiresShipping را روشن کرده‌اند نباید ناگهان
  // قفل شوند. provinces=[] روی یک ردیف یعنی «کل ایران» (ردیف پیش‌فرض)
  private async getShippingCost(
    storeId: string,
    province: string,
  ): Promise<{ cost: number; covered: boolean }> {
    const [provinceRule, defaultRule] = await Promise.all([
      this.prisma.storeShippingRule.findFirst({
        where: { storeId, provinces: { has: province } },
      }),
      this.prisma.storeShippingRule.findFirst({
        where: { storeId, provinces: { equals: [] } },
      }),
    ]);
    const rule = provinceRule ?? defaultRule;
    if (!rule) return { cost: 0, covered: true };
    return { cost: rule.enabled ? rule.cost : 0, covered: rule.enabled };
  }

  // docs/PRD-buyer-payment-method-card-or-snapppay-link.md بخش ۳ — متن آزاد خریدار حین
  // AWAITING_PAYMENT/AWAITING_SELLER_APPROVAL برای paymentMethod=SNAPPPAY، قبل از رسیدن کد
  // رهگیری؛ handleMessage این مسیر را قبل از parseIntent صدا می‌زند (هم‌الگوی handleAddressInput)
  private async handleSnapppayTrackingCodeInput(
    conversation: ConversationWithStore,
    order: Order,
    text: string,
  ): Promise<EngineResult> {
    const code = toEnglishDigits(text).trim();
    if (code.length < 3 || code.length > 100) {
      const reply = fa.salesAgent.snapppayTrackingCodeInvalid;
      await this.logReply(conversation, reply, { type: 'NONE' });
      return {
        reply,
        uiBlocks: [{ type: 'NONE' }],
        state: conversation.currentState,
      };
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { snapppayTrackingCode: code },
    });

    // کد رهگیری بعد از اسکرین‌شات رسیده — نوتیفیکیشن قبلی فروشنده (notifySellerOfReceipt)
    // بدون این کد فرستاده شده بود؛ یک پیام متنی مکمل کافی است، نیازی به ارسال دوباره‌ی عکس نیست
    if (
      order.status === 'RECEIPT_SUBMITTED' &&
      conversation.store.sellerBotChatId
    ) {
      await this.sellerBotApi.sendText(
        conversation.store.sellerBotChatId,
        fa.telegram.receiptSnapppayTrackingCodeFollowUp(order.id, code),
      );
    }

    const reply =
      order.status === 'RECEIPT_SUBMITTED'
        ? fa.salesAgent.snapppayTrackingCodeReceivedAfterScreenshot
        : fa.salesAgent.snapppayTrackingCodeReceivedAwaitingScreenshot;
    await this.logReply(conversation, reply, { type: 'NONE' });
    return {
      reply,
      uiBlocks: [{ type: 'NONE' }],
      state: conversation.currentState,
    };
  }

  async handleReceiptUpload(
    conversation: ConversationWithStore,
    receiptImageKey: string,
  ): Promise<EngineResult> {
    return this.runActionLocked(conversation, (fresh) =>
      this.handleReceiptUploadInner(fresh, receiptImageKey),
    );
  }

  // 3.8 — «رسید ندارم»: بدون عکس؛ همان RECEIPT_SUBMITTED با receiptType=MANUAL_INFO
  async handleManualReceipt(
    conversation: ConversationWithStore,
    info: { cardLast4: string; approxTime: string; trackingCode?: string },
  ): Promise<EngineResult> {
    return this.runActionLocked(conversation, (fresh) =>
      this.handleManualReceiptInner(fresh, info),
    );
  }

  private async handleManualReceiptInner(
    conversation: ConversationWithStore,
    info: { cardLast4: string; approxTime: string; trackingCode?: string },
  ): Promise<EngineResult> {
    const order = await this.prisma.order.findUnique({
      where: { conversationId: conversation.id },
    });
    if (
      !order ||
      conversation.currentState !== 'AWAITING_PAYMENT' ||
      order.status !== 'PENDING_PAYMENT'
    ) {
      return this.doClarify(conversation, fa.salesAgent.noPendingOrder);
    }
    try {
      const moved = await this.orderState.transition({
        orderId: order.id,
        to: 'RECEIPT_SUBMITTED',
        actor: 'BUYER',
        channel: await this.orderChannelOf(this.prisma, conversation),
        data: { receiptType: 'MANUAL_INFO', receiptManualInfo: info },
      });
      if (!moved.changed) {
        return this.doClarify(conversation, fa.salesAgent.noPendingOrder);
      }
    } catch (err) {
      if (err instanceof ConflictException) {
        return this.doClarify(conversation, fa.salesAgent.noPendingOrder);
      }
      throw err;
    }
    const nextState: ConversationState = 'AWAITING_SELLER_APPROVAL';
    await this.persistTransition(
      conversation,
      nextState,
      this.getContext(conversation),
      'submitReceipt',
    );
    const uiBlock: UiBlock = {
      type: 'ORDER_STATUS',
      orderId: order.id,
      status: 'RECEIPT_SUBMITTED',
      orderCode: displayOrderCode(order),
    };
    const reply = fa.salesAgent.receiptReceivedWithCode(
      displayOrderCode(order),
    );
    await this.logReply(conversation, reply, uiBlock);
    // اعلان به فروشنده (بهترین تلاش؛ رسید همین‌جا commit شده)
    try {
      const chatId = conversation.store.sellerBotChatId;
      if (chatId) {
        await this.sellerBotApi.sendText(
          chatId,
          fa.telegram.receiptManualNotification(
            displayOrderCode(order),
            info.cardLast4,
            info.approxTime,
            info.trackingCode,
          ),
          {
            inline_keyboard: [
              [
                {
                  text: fa.telegram.receiptApproveButton,
                  callback_data: `sbap:${order.id}`,
                },
                {
                  text: fa.telegram.receiptRejectButton,
                  callback_data: `sbrj:${order.id}`,
                },
              ],
            ],
          },
        );
      }
    } catch (err) {
      this.logger.error(
        `manual receipt seller notify failed (order=${order.id})`,
        err as Error,
      );
    }
    return { reply, uiBlocks: [uiBlock], state: nextState };
  }

  private async handleReceiptUploadInner(
    conversation: ConversationWithStore,
    receiptImageKey: string,
  ): Promise<EngineResult> {
    const order = await this.prisma.order.findUnique({
      where: { conversationId: conversation.id },
    });
    if (!order || conversation.currentState !== 'AWAITING_PAYMENT') {
      return this.doClarify(conversation, fa.salesAgent.noPendingOrder);
    }

    // 0.13b — فقط سفارش «در انتظار پرداخت» رسید می‌گیرد؛ قبلاً آپدیت بدون شرط، سفارش
    // تاییدشده را دوباره RECEIPT_SUBMITTED می‌کرد (دوبار تایید و دوبار کسر موجودی)
    // 3.2 — انتقال فقط از PENDING_PAYMENT (از طریق OrderStateService؛ از REJECTED مسیر
    // reattach دارد). دستور تکراری/هم‌زمان: changed=false یا Conflict → «سفارشی در انتظار نیست»
    if (order.status !== 'PENDING_PAYMENT') {
      return this.doClarify(conversation, fa.salesAgent.noPendingOrder);
    }
    try {
      const moved = await this.orderState.transition({
        orderId: order.id,
        to: 'RECEIPT_SUBMITTED',
        actor: 'BUYER',
        channel: await this.orderChannelOf(this.prisma, conversation),
        data: { receiptImageKey, receiptType: 'IMAGE' },
      });
      if (!moved.changed) {
        return this.doClarify(conversation, fa.salesAgent.noPendingOrder);
      }
    } catch (err) {
      if (err instanceof ConflictException) {
        return this.doClarify(conversation, fa.salesAgent.noPendingOrder);
      }
      throw err;
    }

    const nextState: ConversationState = 'AWAITING_SELLER_APPROVAL';
    await this.persistTransition(
      conversation,
      nextState,
      this.getContext(conversation),
      'submitReceipt',
    );

    const uiBlock: UiBlock = {
      type: 'ORDER_STATUS',
      orderId: order.id,
      status: 'RECEIPT_SUBMITTED',
      orderCode: displayOrderCode(order),
    };
    const eta = await approvalEtaLabel(this.prisma, conversation.storeId).catch(
      () => fa.orderNotify.etaFallback,
    );
    const reply = await this.caption(
      fa.salesAgent.receiptReceivedWithCode(displayOrderCode(order), eta),
      conversation,
    );
    await this.logReply(conversation, reply, uiBlock);

    // 0.13c — رسید همین‌جا commit شده؛ هرچه بعد از این می‌آید (دانلود، vision، ارسال به
    // فروشنده در تلگرام) «بهترین تلاش» است. قبلاً خطای شبکه‌ی تلگرام کل درخواست را 500 می‌کرد:
    // خریدار خطا می‌دید در حالی که رسید ثبت شده بود و تلاش دوباره می‌گفت «سفارشی نیست».
    try {
      // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۴ گزینه A — خواندن خودکار
      // مبلغ رسید با vision؛ یک‌بار دانلود، هم برای استخراج هم برای ارسال عکس به فروشنده
      const buffer = await this.storage.downloadImage(receiptImageKey);
      await this.notifySellerOfReceipt(
        conversation,
        order.id,
        receiptImageKey,
        buffer,
        null,
      );
      await this.receiptChecks?.enqueue(order.id);
    } catch (err) {
      this.logger.error(
        `post-receipt processing failed (order=${order.id}) — receipt is saved, buyer gets success`,
        err as Error,
      );
    }
    return { reply, uiBlocks: [uiBlock], state: nextState };
  }

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۴ گزینه A — فقط کمک به تصمیم
  // فروشنده (تایید نهایی همچنان دست خودش است)؛ شکست استخراج (عکس بی‌کیفیت/OCR نامشخص) فلو را
  // مسدود نمی‌کند، فقط هیچ خطی به نوتیفیکیشن اضافه نمی‌شود (سکوت امن‌تر از حدس غلط).
  // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — برای SNAPPPAY همان تابع با یک
  // پرامپت vision متفاوت استفاده می‌شود (اسکرین‌شات موفقیت اسنپ‌پی، نه رسید بانکی)؛ این مسیر
  // فقط مبلغ را چک می‌کند، نه مقصد پرداخت (ریسکی که در همان PRD صریح پرچم شده)
  private async verifyReceiptAmount(
    buffer: Buffer,
    receiptImageKey: string,
    expectedAmountToman: number,
    paymentMethod: OrderPaymentMethod = 'CARD_TO_CARD',
  ): Promise<{ extractedAmountToman: number; match: boolean } | null> {
    const ext = receiptImageKey.split('.').pop() ?? 'jpg';
    const dataUrl = `data:${mimeTypeForExt(ext)};base64,${buffer.toString('base64')}`;
    const promptText =
      paymentMethod === 'SNAPPPAY'
        ? 'این تصویر باید اسکرین‌شات صفحه‌ی موفقیت پرداخت اپلیکیشن/وب اسنپ‌پی (Snapp Pay) باشد. مبلغ پرداخت‌شده را به تومان استخراج کن (اگر به ریال نوشته شده، بر ۱۰ تقسیم کن). اگر این تصویر اصلاً شبیه صفحه‌ی موفقیت اسنپ‌پی نیست یا مبلغ قابل‌تشخیص نیست، found را false بگذار و amountToman را null بگذار.'
        : 'این تصویر یک رسید انتقال وجه بانکی ایرانی (کارت‌به‌کارت/پایا/ساتنا) است. مبلغ واریزشده را به تومان استخراج کن (اگر مبلغ روی رسید به ریال نوشته شده، آن را بر ۱۰ تقسیم کن تا به تومان تبدیل شود). اگر مبلغ به‌هیچ‌وجه قابل‌تشخیص نیست، found را false بگذار و amountToman را null بگذار.';
    const visionMessage: UserModelMessage = {
      role: 'user',
      content: [
        { type: 'image', image: dataUrl },
        { type: 'text', text: promptText },
      ],
    };
    const attempt = async (
      model: string,
    ): Promise<{ extractedAmountToman: number; match: boolean } | null> => {
      setCallSite('receipt_vision');
      const { object } = await generateObject({
        maxRetries: LLM_MAX_RETRIES,
        model: this.aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(model),
        schema: z.object({
          found: z.boolean(),
          amountToman: z.number().nullable(),
        }),
        messages: [visionMessage],
      });
      if (!object.found || object.amountToman == null) return null;
      // تلورانس کوچک (۱۰۰۰ تومان) برای خطای رند/OCR، نه برابری دقیق ریاضی
      const match = Math.abs(object.amountToman - expectedAmountToman) <= 1000;
      return { extractedAmountToman: object.amountToman, match };
    };

    try {
      return await attempt(defaultModel());
    } catch (err) {
      this.logger.error(
        `receipt vision extraction failed for key=${receiptImageKey}`,
        err as Error,
      );
      return withDefaultModelFallbackChain(attempt, (model, chainErr) =>
        this.logger.error(
          `receipt vision extraction chain fallback failed (model=${model}, key=${receiptImageKey})`,
          chainErr as Error,
        ),
      );
    }
  }

  // docs/PRD-seller-telegram-management-bot.md — اعلان رسید حالا روی بات دوم (مدیریت پنل)
  // می‌رود، نه بات مشترک مشتری‌محور (ownerTelegramChatId)؛ دکمه‌های تایید/رد همان sbap:/sbrj:
  // هستند که seller-bot.service.ts از قبل برای /orders هم استفاده می‌کند. عکس رسید از پشت
  // JwtGuard+مالکیت سرو می‌شود، پس سرور تلگرام نمی‌تواند خودش آن را fetch کند؛ بایت‌های واقعی
  // multipart آپلود می‌شوند
  private async notifySellerOfReceipt(
    conversation: ConversationWithStore,
    orderId: string,
    receiptImageKey: string,
    buffer: Buffer,
    verification: { extractedAmountToman: number; match: boolean } | null,
  ): Promise<void> {
    const chatId = conversation.store.sellerBotChatId;
    if (!chatId) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderCode: true },
      });
      const code = order ? displayOrderCode(order) : orderId.slice(0, 8);
      await this.notifications.notifySeller({
        storeId: conversation.storeId,
        template: 'SELLER_RECEIPT_NEW',
        entityId: orderId,
        botText: fa.orderNotify.receiptNewSms(code),
        smsText: fa.orderNotify.receiptNewSms(code),
        dedupe: { key: `receipt-new:${orderId}`, ttlSeconds: 24 * 3600 },
      });
      return;
    }
    const ext = receiptImageKey.split('.').pop() ?? 'jpg';
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    const verificationLine = verification
      ? `\n${
          verification.match
            ? fa.telegram.receiptAmountMatch(verification.extractedAmountToman)
            : fa.telegram.receiptAmountMismatch(
                verification.extractedAmountToman,
                order?.totalAmount ?? 0,
              )
        }`
      : '';
    // فیدبک کاربر — فروشنده قبل از تایید/رد سفارش آدرس و مشخصات گیرنده رو نمی‌دید؛ این فیلدها
    // فقط وقتی Store.requiresShipping بوده روی سفارش ست می‌شوند (doCreateOrder)
    const recipientLine = order?.recipientName
      ? fa.telegram.receiptRecipientInfo(
          order.recipientName,
          order.recipientPhone ?? '',
          [order.shippingProvince, order.shippingAddress, order.postalCode]
            .filter(Boolean)
            .join('، '),
        )
      : '';
    // docs/PRD-buyer-payment-method-card-or-snapppay-link.md بخش ۳/۴ — چون لینک اسنپ‌پی
    // ثابت/بدون callback است، نیوو مقصد پرداخت را تایید نمی‌کند؛ کد رهگیری (اگر تا این لحظه
    // رسیده باشد) تنها چیزی است که فروشنده می‌تواند در پنل پذیرندگی خودش کراس‌چک کند
    const snapppayLine =
      order?.paymentMethod === 'SNAPPPAY'
        ? `\n${
            order.snapppayTrackingCode
              ? fa.telegram.receiptSnapppayTrackingCode(
                  order.snapppayTrackingCode,
                )
              : fa.telegram.receiptSnapppayTrackingCodeMissing
          }`
        : '';
    await this.sellerBotApi.sendPhotoBuffer(
      chatId,
      buffer,
      `receipt.${ext}`,
      mimeTypeForExt(ext),
      `${fa.telegram.receiptNotificationCaption(order ? displayOrderCode(order) : orderId.slice(0, 8))}${recipientLine}${verificationLine}${snapppayLine}`,
      {
        inline_keyboard: [
          [
            {
              text: fa.telegram.receiptApproveButton,
              callback_data: `sbap:${orderId}`,
            },
            {
              text: fa.telegram.receiptRejectButton,
              callback_data: `sbrj:${orderId}`,
            },
          ],
        ],
      },
    );
  }

  // docs/PRD-sales-agent-tool-calling-architecture.md بخش ۳.۳ (ابزار cancel_order) — همون
  // پرسیست doCancel، جدا از caption/logReply چون آنجا متن پایانی را خودِ respond_to_customer می‌سازد.
  // لغو سبد سیگنالی درباره‌ی لنگر محصول نیست — صریحاً حفظش می‌کنیم تا خاموش پاک نشود
  private async resetCartState(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
  ): Promise<ConversationContext> {
    const nextCtx: ConversationContext = {
      cart: [],
      lastShownProducts: [],
      anchoredProductId: ctx.anchoredProductId,
      anchorHesitationStreak: ctx.anchorHesitationStreak,
    };
    await this.persistTransition(conversation, 'BROWSING', nextCtx);
    await this.resetClarifyAttempts(conversation);
    return nextCtx;
  }

  private async doCancel(
    conversation: ConversationWithStore,
  ): Promise<EngineResult> {
    if (
      !['GREETING', 'BROWSING', 'CART_REVIEW'].includes(
        conversation.currentState,
      )
    ) {
      return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
    }
    await this.resetCartState(conversation, this.getContext(conversation));
    const facts = fa.salesAgent.cartCleared;
    const reply = await this.caption(facts, conversation);
    await this.logReply(conversation, reply, { type: 'NONE' }, undefined, {
      intent: 'CANCEL',
      handler: 'doCancel',
      factsOrPrompt: facts,
      model: resolveModel(conversation.abVariant),
    });
    return { reply, uiBlocks: [], state: 'BROWSING' };
  }

  // docs/PRD-sales-agent-tool-calling-architecture.md بخش ۳.۳ (ابزار answer_faq) — عیناً همون
  // ترتیب سه‌لایه‌ی doFaq (باکس دانش → توضیح محصولات اخیر → پروفایل فروشگاه)، فقط بدون
  // caption/logReply چون متن نهایی را خودِ respond_to_customer می‌سازد؛ doFaq دست‌نخورده می‌ماند
  private async findFaqAnswer(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    question: string,
    opts: { skipStoreProfileLlm?: boolean } = {},
  ): Promise<{
    source: 'STORE_KB' | 'PRODUCT_DESCRIPTION' | 'STORE_PROFILE';
    fact: string;
  } | null> {
    const match = await this.storeKb.retrieveRelevant(
      conversation.storeId,
      question,
    );
    if (match) {
      if (match.usage) {
        await this.logTextCreditUsage(
          conversation,
          match.usage.model,
          match.usage.inputTokens,
          match.usage.outputTokens,
        );
      }
      return {
        source: 'STORE_KB',
        fact: `سؤال مشتری: ${match.question}\nجواب واقعی: ${match.answer}`,
      };
    }
    const fromDescription = await this.tryAnswerFromProductDescriptions(
      conversation,
      ctx,
      question,
    );
    if (fromDescription) {
      return { source: 'PRODUCT_DESCRIPTION', fact: fromDescription };
    }
    if (opts.skipStoreProfileLlm) return null;
    const fromStoreProfile = await this.tryAnswerFromStoreProfile(
      conversation,
      question,
    );
    if (fromStoreProfile) {
      return { source: 'STORE_PROFILE', fact: fromStoreProfile };
    }
    return null;
  }

  // getStoreFaqAnswer فعلاً stub است (طبق ساده‌سازی پلن گام ۱) — بدون FaqEntry واقعی
  // باکس دانش فروشگاه (docs/PRD-seller-knowledge-base.md بخش ۴) — اگر جواب واقعی پیدا شد،
  // caption() آن را با لحن فروشگاه بازنویسی می‌کند؛ اگر نه، قبل از stub، توضیح محصولاتی که
  // اخیراً به مشتری نشان داده شده امتحان می‌شود (فروشنده‌ها معمولاً توضیح محصول را دارند ولی
  // باکس دانش را جدا پر نمی‌کنند) — فقط اگر جواب واقعی از همان توضیح پیدا شد استفاده می‌شود؛
  // اگر نه، همان stub قبلی + flag برای ریپورت ادمین
  private async doFaq(
    conversation: ConversationWithStore,
    question: string,
    ctx: ConversationContext,
  ): Promise<EngineResult> {
    const match = await this.storeKb.retrieveRelevant(
      conversation.storeId,
      question,
    );
    if (match) {
      if (match.usage) {
        await this.logTextCreditUsage(
          conversation,
          match.usage.model,
          match.usage.inputTokens,
          match.usage.outputTokens,
        );
      }
      const facts = `سؤال مشتری: ${match.question}\nجواب واقعی: ${match.answer}`;
      const reply = await this.caption(facts, conversation);
      await this.logReply(conversation, reply, { type: 'NONE' }, undefined, {
        intent: 'ASK_FAQ',
        handler: 'doFaq',
        factsOrPrompt: facts,
        model: resolveModel(conversation.abVariant),
        kbSource: 'STORE_KB',
      });
      return { reply, uiBlocks: [], state: conversation.currentState };
    }

    const fromDescription = await this.tryAnswerFromProductDescriptions(
      conversation,
      ctx,
      question,
    );
    if (fromDescription) {
      // این مسیر مستقیم generateObject خودش را دارد (نه caption()) و همیشه با defaultModel()
      // صدا زده می‌شود، نه resolveModel(abVariant) — طبق پیاده‌سازی واقعی tryAnswerFromProductDescriptions
      await this.logReply(
        conversation,
        fromDescription,
        { type: 'NONE' },
        undefined,
        {
          intent: 'ASK_FAQ',
          handler: 'doFaq',
          factsOrPrompt: question,
          model: defaultModel(),
          kbSource: 'PRODUCT_DESCRIPTION',
        },
      );
      return {
        reply: fromDescription,
        uiBlocks: [],
        state: conversation.currentState,
      };
    }

    const fromStoreProfile = await this.tryAnswerFromStoreProfile(
      conversation,
      question,
    );
    if (fromStoreProfile) {
      await this.logReply(
        conversation,
        fromStoreProfile,
        { type: 'NONE' },
        undefined,
        {
          intent: 'ASK_FAQ',
          handler: 'doFaq',
          factsOrPrompt: question,
          model: defaultModel(),
          kbSource: 'STORE_PROFILE',
        },
      );
      return {
        reply: fromStoreProfile,
        uiBlocks: [],
        state: conversation.currentState,
      };
    }

    const reply = await this.caption(fa.salesAgent.faqStub, conversation);
    await this.logReply(conversation, reply, { type: 'NONE' }, 'NO_KB_MATCH', {
      intent: 'ASK_FAQ',
      handler: 'doFaq',
      factsOrPrompt: fa.salesAgent.faqStub,
      model: resolveModel(conversation.abVariant),
      kbSource: 'STUB',
    });
    return { reply, uiBlocks: [], state: conversation.currentState };
  }

  // فقط محصولاتی که همین الان به مشتری نشان داده شده‌اند (lastShownProducts) — حدس‌زدن محصول
  // مورد نظر از روی کل کاتالوگ ریسک جواب غلط دارد. اگر توضیح آن محصولات هم چیزی نداشت که به
  // سؤال بخورد، null برمی‌گردد (مدل صریح باید بگوید answered=false، نه اینکه جواب اختراع کند)
  private async tryAnswerFromProductDescriptions(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    question: string,
  ): Promise<string | null> {
    const recentIds = ctx.lastShownProducts?.map((p) => p.id) ?? [];
    if (recentIds.length === 0) return null;

    const products = await this.prisma.product.findMany({
      where: { id: { in: recentIds }, storeId: conversation.storeId, ...BUYER_VISIBLE },
      select: { name: true, description: true, specs: true },
    });
    const withDescription = products.filter(
      (p): p is (typeof products)[number] & { description: string } =>
        !!p.description?.trim(),
    );
    if (withDescription.length === 0) return null;

    const tone = toneForCategory(conversation.store.category);
    const attempt = async (model: string): Promise<string | null> => {
      setCallSite('faq_desc');
      const { object, usage } = await generateObject({
        maxRetries: LLM_MAX_RETRIES,
        // فیدبک کاربر ۱۴۰۵/۰۷/۲۱ — بدون supportsStructuredOutputs=true، @ai-sdk/openai-compatible
        // فقط response_format: {type:'json_object'} می‌فرستد؛ بعضی مدل‌ها/provider ها (مثل
        // openai/gpt-6-luna روی Azure) این حالت را رد می‌کنند مگر کلمه‌ی «json» عیناً در پیام‌های
        // ورودی باشد (که پرامپت فارسی زیر ندارد) — دقیقاً همان AI_APICallError 400 که با اضافه‌شدن
        // DEFAULT_MODEL_FALLBACK_CHAIN به این تابع بروز کرد. همان فیکس callParseIntent/store-kb.service.ts.
        model: this.aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(model),
        schema: z.object({
          answered: z.boolean(),
          reply: z.string().optional(),
        }),
        system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. زیر توضیح چند محصول
(نوشته‌ی خودِ فروشنده) را داری. اگر واقعاً می‌شود از همین توضیحات به سؤال مشتری جواب داد،
answered=true و یک پیام فارسی کوتاه (۲-۳ جمله، لحن ${tone}) بده — هیچ چیزی (قیمت/موجودی/مشخصات)
که در توضیحات نیامده حدس نزن یا اختراع نکن. اگر توضیحات ربطی به این سؤال ندارد یا کافی نیست،
answered=false بده (به‌جای حدس‌زدن).`,
        prompt: `توضیح محصولات:\n${withDescription.map((p) => `${p.name}: ${p.description}${formatSpecsForFacts(parseProductSpecs(p.specs))}`).join('\n')}\n\nسؤال مشتری: ${question}`,
      });
      await this.logTextCreditUsage(
        conversation,
        model,
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
      );
      return object.answered ? (object.reply ?? '').trim() || null : null;
    };

    try {
      const lightFaq = await aceActive('subcallDiet');
      if (lightFaq) aceNote('subcallDiet', 'پاسخ از توضیحات/پروفایل با مدل سبک تولید شد (به‌جای مدل اصلی)', 'faq_desc');
      return await attempt(lightFaq ? PERCEPTION_MODEL : defaultModel());
    } catch (err) {
      this.logger.error(
        `tryAnswerFromProductDescriptions failed (conversation=${conversation.id})`,
        err as Error,
      );
      return withDefaultModelFallbackChain(attempt, (model, chainErr) =>
        this.logger.error(
          `tryAnswerFromProductDescriptions chain fallback failed (model=${model}, conversation=${conversation.id})`,
          chainErr as Error,
        ),
      );
    }
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — فیلدهای ساختاریافته‌ی سطح فروشگاه
  // (ارسال/مرجوعی/معرفی برند)، همیشه در دسترس بدون نیاز به retrieval روی باکس دانش. دقیقاً
  // الگوی tryAnswerFromProductDescriptions: یک فراخوان ارزان تصمیم می‌گیرد آیا واقعاً جواب
  // این سؤال است، هیچ‌چیز فراتر از همین سه فیلد حدس زده نمی‌شود
  private async tryAnswerFromStoreProfile(
    conversation: ConversationWithStore,
    question: string,
  ): Promise<string | null> {
    const { shippingInfo, returnPolicy, brandIntro } = conversation.store;
    const shippingDays = formatShippingDays(
      conversation.store.shippingDaysMin,
      conversation.store.shippingDaysMax,
    );
    const shippingRulesSummary = await formatShippingRulesSummary(
      this.prisma,
      conversation.storeId,
    );
    if (
      !shippingInfo &&
      !shippingDays &&
      !shippingRulesSummary &&
      !returnPolicy &&
      !brandIntro
    )
      return null;

    const facts = [
      shippingInfo && `ارسال/هزینه‌ی ارسال: ${shippingInfo}`,
      shippingDays && `زمان ارسال: ${shippingDays}`,
      shippingRulesSummary &&
        `هزینه‌ی ارسال به‌تفکیک استان:\n${shippingRulesSummary}`,
      returnPolicy && `شرایط مرجوعی/گارانتی: ${returnPolicy}`,
      brandIntro && `معرفی فروشگاه: ${brandIntro}`,
    ]
      .filter(Boolean)
      .join('\n');

    const tone = toneForCategory(conversation.store.category);
    const attempt = async (model: string): Promise<string | null> => {
      setCallSite('faq_profile');
      const { object, usage } = await generateObject({
        maxRetries: LLM_MAX_RETRIES,
        // همون فیکس tryAnswerFromProductDescriptions بالا — بدون supportsStructuredOutputs=true
        // بعضی مدل‌ها/provider های زنجیره‌ی fallback با 400 «must contain the word json» رد می‌شوند
        model: this.aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(model),
        schema: z.object({
          answered: z.boolean(),
          reply: z.string().optional(),
        }),
        system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. زیر چند واقعیت ثابت
درباره‌ی خودِ فروشگاه (نه یک محصول خاص) را داری. اگر واقعاً می‌شود از همین واقعیت‌ها به سؤال
مشتری جواب داد، answered=true و یک پیام فارسی کوتاه (۱-۲ جمله، لحن ${tone}) بده — هیچ چیزی که
اینجا نیامده حدس نزن یا اختراع نکن. اگر ربطی به این سؤال ندارد یا کافی نیست، answered=false بده.`,
        prompt: `اطلاعات فروشگاه:\n${facts}\n\nسؤال مشتری: ${question}`,
      });
      await this.logTextCreditUsage(
        conversation,
        model,
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
      );
      return object.answered ? (object.reply ?? '').trim() || null : null;
    };

    try {
      const lightFaq = await aceActive('subcallDiet');
      if (lightFaq) aceNote('subcallDiet', 'پاسخ از توضیحات/پروفایل با مدل سبک تولید شد (به‌جای مدل اصلی)', 'faq_profile');
      return await attempt(lightFaq ? PERCEPTION_MODEL : defaultModel());
    } catch (err) {
      this.logger.error(
        `tryAnswerFromStoreProfile failed (conversation=${conversation.id})`,
        err as Error,
      );
      return withDefaultModelFallbackChain(attempt, (model, chainErr) =>
        this.logger.error(
          `tryAnswerFromStoreProfile chain fallback failed (model=${model}, conversation=${conversation.id})`,
          chainErr as Error,
        ),
      );
    }
  }

  private async doClarify(
    conversation: ConversationWithStore,
    hint: string,
    flag?: 'UNCLEAR',
  ): Promise<EngineResult> {
    const attempts = conversation.clarifyAttempts + 1;
    if (attempts >= HANDOFF_CLARIFY_THRESHOLD) {
      return this.transitionToHandoff(conversation, 'AGENT_STUCK');
    }
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: { clarifyAttempts: attempts },
    });
    await this.logReply(conversation, hint, { type: 'NONE' }, flag);
    return { reply: hint, uiBlocks: [], state: conversation.currentState };
  }

  // فقط برای شاخه‌ی UNCLEAR واقعی (نه سایر doClarify هایی که پیام مشخص‌تری دارند مثل
  // «موجودی کافی نیست») — فیدبک اول پایلوت: راهنمای عمومی «متوجه نشدم» کافی نبود، اگر
  // لیست محصولاتی قبلاً نشان داده شده، نمونه‌ی اسم آن‌ها هم اضافه می‌شود
  private async doClarifyUnclear(
    conversation: ConversationWithStore,
  ): Promise<EngineResult> {
    const ctx = this.getContext(conversation);
    const names = ctx.lastShownProducts?.slice(0, 2).map((p) => p.name) ?? [];
    const hint = names.length
      ? fa.salesAgent.didNotUnderstandWithHint(names)
      : fa.salesAgent.didNotUnderstand;
    return this.doClarify(conversation, hint, 'UNCLEAR');
  }

  private async resetClarifyAttempts(conversation: ConversationWithStore) {
    if (conversation.clarifyAttempts > 0) {
      await this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: { clarifyAttempts: 0 },
      });
    }
  }

  private async paymentMethodMissing(
    conversation: ConversationWithStore,
  ): Promise<EngineResult> {
    const nextState: ConversationState = 'HANDOFF_HUMAN';
    await this.persistTransition(
      conversation,
      nextState,
      this.getContext(conversation),
      'PAYMENT_METHOD_MISSING',
    );
    const reply = fa.salesAgent.paymentMethodMissing;
    await this.logReply(conversation, reply, { type: 'NONE' });
    const chatId = conversation.store.sellerBotChatId;
    if (chatId) {
      await this.sellerBotApi.sendText(
        chatId,
        fa.telegram.paymentMethodMissingNotification,
        {
          inline_keyboard: [
            [
              {
                text: fa.telegram.handoffReplyButton,
                callback_data: `sbrp:${conversation.id}`,
              },
            ],
          ],
        },
      );
    } else {
      await this.notifications.notifySeller({
        storeId: conversation.storeId,
        template: 'PAYMENT_METHOD_MISSING',
        entityId: conversation.storeId,
        botText: fa.telegram.paymentMethodMissingSms,
        smsText: fa.telegram.paymentMethodMissingSms,
        dedupe: {
          key: `payment-method-missing:${conversation.storeId}`,
          ttlSeconds: CREDIT_ALERT_DEDUPE_TTL_SECONDS,
        },
      });
    }
    return { reply, uiBlocks: [], state: nextState };
  }

  private async transitionToHandoff(
    conversation: ConversationWithStore,
    reason:
      | 'CUSTOMER_REQUESTED'
      | 'AGENT_STUCK'
      | 'BILLING_BLOCKED'
      // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۲ — گروه‌های P1 (PAYMENT_ISSUE/
      // POST_PURCHASE_SUPPORT در buyerNeeds)؛ ربات Tool ای برای این‌ها ندارد، مستقیم ارجاع
      | 'SUPPORT_NEEDED'
      // R1.2 — kill switch سراسری هوش مصنوعی (SalesAgentGlobalConfig.aiEnabled=false)
      | 'AI_DISABLED',
    // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۳.۲ — دلیل آزاد مدل وقتی
    // request_human_handoff را صدا می‌زند؛ قبلاً دور ریخته می‌شد، الان در ConversationEvent
    // ذخیره می‌شود تا aggregator پیشنهاد تکمیل پروفایل (بخش ۳.۳) از آن استفاده کند
    freeTextReason?: string,
  ): Promise<EngineResult> {
    const nextState: ConversationState = 'HANDOFF_HUMAN';
    await this.persistTransition(
      conversation,
      nextState,
      this.getContext(conversation),
      reason,
      freeTextReason,
    );
    // 1.3 — مکالمه‌ای که به‌خاطر اعتبار handoff شد BLOCKED می‌ماند تا بعد از شارژ/unmute
    // بازارزیابی شود (reevaluateBlockedConversations)؛ turnهای بعدی رزرو/AI نمی‌خواهند
    if (
      reason === 'BILLING_BLOCKED' &&
      conversation.billingMode !== 'BLOCKED'
    ) {
      await this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: { billingMode: 'BLOCKED' },
      });
    }
    const reply =
      reason === 'BILLING_BLOCKED'
        ? fa.salesAgent.billingBlockedHandoff
        : reason === 'AI_DISABLED'
          ? fa.salesAgent.aiDisabledHandoff
          : reason === 'SUPPORT_NEEDED'
          ? fa.salesAgent.supportNeededHandoff
          : this.isWithinWorkingHours(conversation.store)
            ? fa.salesAgent.handoffToHuman
            : fa.salesAgent.handoffToHumanOutOfHours;
    await this.logReply(conversation, reply, { type: 'NONE' });
    await this.notifySellerOfHandoff(conversation, reason);
    return { reply, uiBlocks: [], state: nextState };
  }

  // docs/PRD-nivo-lead-shop-seller-signup.md §5.2 — بازتعریف: دیگر گفتگو را COMPLETED نمی‌کند و
  // «زنگ می‌زنم» نمی‌گوید. فقط لید را upsert می‌کند (کلید storeId+conversationId) و کارت ثبت‌نام
  // (SIGNUP_CARD) را برمی‌گرداند؛ ارسال شماره/OTP و اتصال به User کار فرانت + LeadSignupService است
  private async captureLead(
    conversation: ConversationWithStore,
    args: { phone?: string; name?: string; interest?: string },
  ): Promise<EngineResult> {
    // شماره‌ی نامعتبر نادیده گرفته می‌شود (کارت بدون prefill)
    const phone = normalizeLeadPhone(args.phone);
    const where = {
      storeId_conversationId: { storeId: conversation.storeId, conversationId: conversation.id },
    };
    await this.prisma.leadProfile.upsert({
      where,
      create: {
        storeId: conversation.storeId,
        conversationId: conversation.id,
        phone: phone ?? undefined,
        name: args.name,
        interests: args.interest ? [args.interest] : undefined,
        source: 'sales_agent_lead_capture',
      },
      update: {
        ...(args.name ? { name: args.name } : {}),
        ...(args.interest ? { interests: [args.interest] } : {}),
      },
    });
    // سرور-محور (نه خوداظهاری مدل): فقط وقتی capture_lead واقعاً اجرا شده؛ LEAD_CAPTURED بعد از ارسال شماره
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: { leadFunnelStage: 'READY_TO_CAPTURE' },
    });
    const uiBlock: UiBlock = phone
      ? { type: 'SIGNUP_CARD', prefillPhone: phone }
      : { type: 'SIGNUP_CARD' };
    const reply = fa.salesAgent.leadSignupPrompt;
    await this.logReply(conversation, reply, uiBlock);
    return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
  }

  // docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — وقتی هر دو فیلد ست نشده، یعنی
  // فروشگاه محدودیتی اعلام نکرده و همیشه «در ساعت کاری» حساب می‌شود. مقایسه با ساعت تهران
  // (تک‌منطقه‌ی زمانی، نیازی به ذخیره‌ی timezone جدا نیست) روی دقیقه‌های روز، شامل بازه‌ی
  // شبانه که از نیمه‌شب رد می‌شود (مثلاً ۲۲:۰۰ تا ۰۲:۰۰)
  private isWithinWorkingHours(store: {
    workingHoursStart: string | null;
    workingHoursEnd: string | null;
  }): boolean {
    if (!store.workingHoursStart || !store.workingHoursEnd) return true;

    const toMinutes = (hhmm: string): number => {
      const [h, m] = hhmm.split(':').map(Number);
      return h * 60 + m;
    };
    const start = toMinutes(store.workingHoursStart);
    const end = toMinutes(store.workingHoursEnd);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const now = hour * 60 + minute;

    return start <= end
      ? now >= start && now <= end
      : now >= start || now <= end;
  }

  // docs/PRD-seller-telegram-management-bot.md — اگر فروشنده بات مدیریت پنل را وصل کرده
  // باشد (sellerBotChatId، نه ownerTelegramChatId قدیمی)، سؤال مشتری + دکمه‌ی «پاسخ بده»
  // مستقیم پوش می‌شود؛ اگر نه، بی‌صدا رد می‌شود (فروشنده فقط از پنل «نیاز به توجه» می‌بیند)
  private async notifySellerOfHandoff(
    conversation: ConversationWithStore,
    reason:
      | 'CUSTOMER_REQUESTED'
      | 'AGENT_STUCK'
      | 'BILLING_BLOCKED'
      | 'SUPPORT_NEEDED'
      | 'AI_DISABLED',
  ): Promise<void> {
    // 1.5 — «اعتبار تمام شد» حداکثر روزی یک‌بار به‌ازای فروشگاه (بات + SMS)، نه به‌ازای هر مکالمه
    if (reason === 'BILLING_BLOCKED') {
      await this.creditAlerts.notifyExhausted(conversation.storeId);
      return;
    }

    const chatId = conversation.store.sellerBotChatId;
    if (!chatId) {
      await this.notifications.notifySeller({
        storeId: conversation.storeId,
        template: 'SELLER_HANDOFF',
        entityId: conversation.id,
        botText: fa.telegram.handoffSms,
        smsText: fa.telegram.handoffSms,
        dedupe: { key: `handoff:${conversation.id}`, ttlSeconds: 5 * 60 },
      });
      return;
    }

    const lastCustomerMessage = await this.prisma.conversationEvent.findFirst({
      where: { conversationId: conversation.id, type: 'CUSTOMER_MESSAGE' },
      orderBy: { createdAt: 'desc' },
    });
    const customerText =
      (lastCustomerMessage?.payload as { text?: string } | undefined)?.text ??
      '—';
    await this.sellerBotApi.sendText(
      chatId,
      fa.telegram.handoffNotification(customerText),
      {
        inline_keyboard: [
          [
            {
              text: fa.telegram.handoffReplyButton,
              callback_data: `sbrp:${conversation.id}`,
            },
          ],
        ],
      },
    );
  }

  // docs/PRD-seller-credit-billing.md بخش ۳ — سهمیه‌ی رایگان تمام و اعتبار فروشگاه هم صفر/منفی؛
  // این مکالمه از قبل (لحظه‌ی ساخت، decideBillingMode) به همین حالت قفل شده — بدون هیچ فراخوان AI
  private billingBlocked(conversation: ConversationWithStore): boolean {
    return conversation.billingMode === 'BLOCKED';
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۲.۵ — فقط فروشگاه‌های دمو
  // (isDemo) را چک می‌کند؛ بعد از عبور از سقف، همیشه همین پیام ثابت برمی‌گردد (بدون فراخوان AI)
  private async checkDemoMessageCap(
    conversation: ConversationWithStore,
  ): Promise<EngineResult | null> {
    if (!conversation.store.isDemo) return null;
    const messageCount = await this.prisma.conversationEvent.count({
      where: { conversationId: conversation.id, type: 'CUSTOMER_MESSAGE' },
    });
    if (messageCount <= DEMO_MESSAGE_CAP) return null;
    await this.logReply(conversation, fa.salesAgent.demoMessageLimitReached, {
      type: 'NONE',
    });
    return {
      reply: fa.salesAgent.demoMessageLimitReached,
      uiBlocks: [],
      state: conversation.currentState,
    };
  }

  // docs/PRD-buyer-abuse-rate-limit.md — باید همین ابتدای هر پیام/اکشن واقعی مشتری چک شود،
  // قبل از هر فراخوان AI (حتی قبل از چک billingBlocked، چون این ارزان‌تر و اولویت‌دارتر است).
  // null یعنی مسدود نبوده، ادامه بده؛ غیر-null یعنی همین نتیجه را مستقیم برگردان.
  private async checkAbuseGuard(
    conversation: ConversationWithStore,
  ): Promise<EngineResult | null> {
    const { blocked, justLocked } = await this.abuseGuard.checkAndRecord(
      conversation.customerId,
    );
    if (!blocked) return null;
    if (justLocked) {
      await this.logReply(conversation, fa.salesAgent.abuseLocked, {
        type: 'NONE',
      });
      return {
        reply: fa.salesAgent.abuseLocked,
        uiBlocks: [],
        state: conversation.currentState,
      };
    }
    // از قبل قفل بوده — سکوت کامل، طبق تصمیم بخش ۵ سند (بدون لاگ AGENT_REPLY تازه)
    return { reply: '', uiBlocks: [], state: conversation.currentState };
  }

  // یک ConversationEvent(TOOL_CALL) + یک ConversationEvent(STATE_TRANSITION) + آپدیت
  // SalesConversation.currentState/contextData همگی در یک تراکنش (طبق پلن گام ۱)
  private async persistTransition(
    conversation: ConversationWithStore,
    nextState: ConversationState,
    context: ConversationContext,
    toolName?: string,
    // بخش ۳.۲ — دلیل آزاد `request_human_handoff`؛ فقط برای CUSTOMER_REQUESTED پر می‌شود
    note?: string,
  ) {
    const fromState = conversation.currentState;
    // 0.4(۵) — کمربند دوم زیر قفل Redis: اگر کسی (cron، مسیر بدون قفل) بین خواندن و نوشتن
    // مکالمه را عوض کرده باشد، version عوض شده و نوشتن شرطی count=0 می‌دهد
    const attempt = async (
      expectedVersion: number,
      ctxToWrite: ConversationContext,
    ) =>
      this.prisma.$transaction(async (tx) => {
        const updated = await tx.salesConversation.updateMany({
          where: { id: conversation.id, version: expectedVersion },
          data: {
            currentState: nextState,
            contextData: ctxToWrite,
            isMutedForHuman: nextState === 'HANDOFF_HUMAN' ? true : undefined,
            version: { increment: 1 },
          },
        });
        if (updated.count === 0) return false;
        if (toolName) {
          await tx.conversationEvent.create({
            data: {
              conversationId: conversation.id,
              type: 'TOOL_CALL',
              payload: note ? { toolName, note } : { toolName },
            },
          });
        }
        await tx.conversationEvent.create({
          data: {
            conversationId: conversation.id,
            type: 'STATE_TRANSITION',
            payload: { fromState, toState: nextState },
          },
        });
        return true;
      });

    let written = context;
    let expected = conversation.version ?? 0;
    if (!(await attempt(expected, written))) {
      // تعارض نسخه: آخرین وضعیت را بخوان و سبد را ادغام کن (هیچ آیتمی گم نشود)، یک‌بار دوباره
      const latest = await this.prisma.salesConversation.findUnique({
        where: { id: conversation.id },
        select: { version: true, contextData: true },
      });
      if (!latest) return;
      this.logger.warn(
        `persistTransition version conflict (conversation=${conversation.id}, expected=${expected}, actual=${latest.version}) — merging cart`,
      );
      const latestCart =
        (latest.contextData as unknown as ConversationContext | null)?.cart ??
        [];
      const mine = new Set(written.cart.map((i) => lineKey(i)));
      written = {
        ...written,
        cart: [
          ...written.cart,
          ...latestCart.filter((i) => !mine.has(lineKey(i))),
        ],
      };
      expected = latest.version;
      if (!(await attempt(expected, written))) {
        throw new Error(
          `persistTransition: conversation ${conversation.id} changed concurrently`,
        );
      }
    }
    conversation.version = expected + 1;
    conversation.currentState = nextState;
    // بخش ۱.۴ docs/PRD-full-agent-engineering-review.md — قبلاً فقط ردیف DB آپدیت می‌شد، نه
    // آبجکت درون‌حافظه‌ای؛ چون runFullAgentTurn همین آبجکت conversation را بین تلاش اول و
    // fallback پاس می‌دهد (بدون fetch دوباره)، بدون این خط هر retry از وضعیت قبل از جهش
    // (نه چیزی که واقعاً در DB نشسته) ادامه می‌داد
    conversation.contextData = written;
  }

  // docs/PRD-buyer-chat-redesign.md B2 — PRODUCT_CARD از چند مسیر ساخته می‌شود (بعضی بدون
  // optionTypes)، پس یک‌جا و قبل از ثبت، با یک query سبک hasVariants را پر می‌کنیم.
  // docs/PRD-fixes-after-buyer-redesign.md F2 — محصولات همان آبجکت‌ها در جا آپدیت می‌شوند
  // (نه کپی)، چون callerها بلوکِ خودشان را به کلاینت برمی‌گردانند و باید پرچم را ببینند
  private async withHasVariants(uiBlock: UiBlock): Promise<UiBlock> {
    if (uiBlock.type !== 'PRODUCT_CARD' || uiBlock.products.length === 0) {
      return uiBlock;
    }
    const rows = await this.prisma.productOptionType.findMany({
      where: { productId: { in: uiBlock.products.map((p) => p.id) } },
      select: { productId: true },
      distinct: ['productId'],
    });
    const withOptions = new Set(rows.map((row) => row.productId));
    for (const p of uiBlock.products) {
      p.hasVariants = withOptions.has(p.id);
    }
    return uiBlock;
  }

  private async logReply(
    conversation: ConversationWithStore,
    text: string,
    uiBlock: UiBlock,
    flag?: 'UNCLEAR' | 'NO_KB_MATCH',
    trace?: AiTraceData,
    // docs/PRD-sales-agent-sales-state-machine.md §۱۲.۱ — فقط مسیر ماشین‌حالت فروش
    quickReplies?: string[],
  ) {
    // §۴.۴ — قبل از ذخیره‌ی AGENT_REPLY (و تولید وویس) دوباره چک می‌شود
    if (await this.sellerTookOverMidTurn(conversation.id)) return;
    uiBlock = await this.withHasVariants(uiBlock);
    // برخلاف قبل، طول کوتاه/رسیدن به سقف باید از هم تفکیک شوند (نه فقط یک بولین) — بخش
    // voice.reason در AI_TRACE (docs/PRD-admin-ai-decision-trace-log.md بخش ۱) به همین نیاز دارد
    let wantsVoice = false;
    let voiceReason:
      | 'TOO_SHORT'
      | 'CONVERSATION_CAP'
      | 'VOICE_VARIANT_OFF'
      | 'CONSECUTIVE_CAP'
      | 'STORE_NO_CREDIT_CAP'
      | 'STORE_VOICE_DISABLED'
      | undefined;
    if (text.length > VOICE_MIN_REPLY_CHARS) {
      // فیدبک کاربر ۱۴۰۵/۰۷/۱۸ — سوئیچ فروشنده (Store.voiceRepliesEnabled، دیفالت خاموش) قبل
      // از همه‌ی چک‌های دیگر؛ هزینه‌ی واقعی هر وویس بالاست، پس خودِ فروشنده باید صریحاً روشنش کند
      if (!conversation.store.voiceRepliesEnabled) {
        voiceReason = 'STORE_VOICE_DISABLED';
      } else if (
        // docs/PRD-sales-agent-voice.md بخش ۶.۱ — گروه OFF باید واقعاً هیچ وویسی نبیند، نه
        // فقط اینکه پخش نشود؛ پس قبل از reserveVoiceSlot چک می‌شود (سهمیه‌ی مکالمه هم دست‌نخورده می‌ماند)
        conversation.voiceVariant === 'OFF'
      ) {
        voiceReason = 'VOICE_VARIANT_OFF';
      } else if (
        conversation.consecutiveVoiceReplyCount >= VOICE_MAX_CONSECUTIVE
      ) {
        // docs/PRD-sales-agent-voice.md بخش ۶.۳ — حتی اگر واجد شرایط باشد (طول کافی، سقف کل
        // مکالمه هم خالی)، بعد از ۲ تای پشت‌سرهم باید فقط متن بماند
        voiceReason = 'CONSECUTIVE_CAP';
      } else if (
        // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — فروشنده‌ی بدون اعتبار حداکثر ۳ مکالمه‌ی مجزا وویس می‌گیرد؛
        // فقط روی اولین وویسِ هر مکالمه چک می‌شود (نه هر پاسخ) تا شمارنده‌ی فروشگاه یک‌بار
        // به‌ازای هر مکالمه زیاد شود
        conversation.billingMode !== 'PAID' &&
        conversation.voiceGenerationCount === 0 &&
        !(await this.reserveFreeVoiceConversationSlot(conversation.storeId))
      ) {
        voiceReason = 'STORE_NO_CREDIT_CAP';
      } else if (!(await this.creditService.canSpend(conversation.storeId))) {
        // 1.2(۱) — TTS هزینه‌ی واقعی دارد؛ زیر کف overdraft وویس تولید نمی‌شود (فقط متن)
        voiceReason = 'STORE_NO_CREDIT_CAP';
      } else {
        wantsVoice = await this.reserveVoiceSlot(conversation.id);
        if (!wantsVoice) voiceReason = 'CONVERSATION_CAP';
      }
    } else {
      voiceReason = 'TOO_SHORT';
    }
    // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — «چرا تلگرام وویس نمیده» قبلاً فقط از DB (AI_TRACE، وقتی اصلاً
    // ساخته می‌شد) قابل بازسازی بود؛ یک خط لاگ ساده روی بک‌اند کافی است که سریع با grep دیده شود
    this.logger.log(
      `voice decision conversation=${conversation.id} billingMode=${conversation.billingMode} voiceVariant=${conversation.voiceVariant} replyChars=${text.length} voiceGenCount=${conversation.voiceGenerationCount} consecutiveVoiceCount=${conversation.consecutiveVoiceReplyCount} -> ${wantsVoice ? 'GENERATE' : `SKIP(${voiceReason})`}`,
    );
    // شمارنده‌ی متوالی: با هر پاسخی که وویس گرفت زیاد می‌شود، با هر پاسخی که نگرفت صفر می‌شود؛
    // وقتی از قبل هم صفر بود و همچنان وویس نگرفت، نیازی به نوشتن دوباره نیست
    if (wantsVoice) {
      await this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: { consecutiveVoiceReplyCount: { increment: 1 } },
      });
    } else if (conversation.consecutiveVoiceReplyCount > 0) {
      await this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: { consecutiveVoiceReplyCount: 0 },
      });
    }

    // docs/PRD-admin-ai-decision-trace-log.md — قبلاً voice فقط داخل AI_TRACE ثبت می‌شد که
    // فقط برای پاسخ‌های AI-محور ساخته می‌شود (trace پارامتر اختیاری)؛ پاسخ‌های قانون‌محور ثابت
    // (فاکتور/سبد/handoff/...) که trace ندارند هیچ‌وقت در پنل ادمین معلوم نمی‌کرد وویس گرفته‌اند
    // یا نه و چرا. چون AGENT_REPLY (همین event) همیشه برای هر پاسخی ساخته می‌شود، voice هم
    // همیشه همین‌جا ثبت می‌شود — finishEvent در sales-agent-voice.processor.ts بعداً این فیلد
    // را با نتیجه‌ی نهایی (موفق/ناموفق) آپدیت می‌کند
    const turnId = currentShopTurnId();
    // موتور این نوبت + لایه‌های بهینه‌سازی که واقعاً به‌کار رفتند (با علت) — برای لاگ مکالمه‌ی ادمین
    const aceInfo = aceTraceInfo();
    const acePayload = {
      engine: aceInfo.engine,
      ...(aceInfo.used.length ? { ace: aceInfo.used } : {}),
    } as unknown as Prisma.InputJsonObject;
    const payload: Prisma.InputJsonObject = {
      ...acePayload,
      text,
      uiBlock,
      ...(flag ? { flag } : {}),
      ...(quickReplies?.length ? { quickReplies } : {}),
      ...(turnId ? { turnId } : {}),
      ...(wantsVoice ? { voicePending: true } : {}),
      voice: wantsVoice
        ? { generated: true }
        : { generated: false, reason: voiceReason },
    };

    const event = await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'AGENT_REPLY',
        payload,
      },
    });
    await touchConversation(this.prisma, conversation.id, 'AGENT');

    let traceEventId: string | undefined;
    if (trace) {
      const tracePayload: Prisma.InputJsonObject = {
        ...acePayload,
        intent: trace.intent,
        handler: trace.handler,
        factsOrPrompt: trace.factsOrPrompt,
        model: trace.model,
        ...(trace.kbSource ? { kbSource: trace.kbSource } : {}),
        // docs/PRD-sales-agent-persuasion-principles.md بخش ۸ — فقط روی trace سطح
        // runFullAgentTurn پر می‌شود؛ خوداظهاری خودِ مدل در respond_to_customer
        ...(trace.persuasionTechniquesUsed?.length
          ? { persuasionTechniquesUsed: trace.persuasionTechniquesUsed }
          : {}),
        ...(trace.usedGeneralKnowledge ? { usedGeneralKnowledge: true } : {}),
        // docs/PRD-full-agent-engineering-review.md بخش ۵ — observability؛ فقط روی trace سطح
        // runFullAgentTurn پر می‌شوند
        ...(trace.relevantProductIdsRaw
          ? { relevantProductIdsRaw: trace.relevantProductIdsRaw }
          : {}),
        ...(trace.lastShownProducts
          ? { lastShownProducts: trace.lastShownProducts }
          : {}),
        ...(trace.toolsCalled
          ? {
              toolsCalled:
                trace.toolsCalled as unknown as Prisma.InputJsonValue,
            }
          : {}),
        ...(trace.initialCatalogProductIds
          ? { initialCatalogProductIds: trace.initialCatalogProductIds }
          : {}),
        ...(trace.stepsUsed !== undefined
          ? { stepsUsed: trace.stepsUsed }
          : {}),
        ...(trace.mutationHappened ? { mutationHappened: true } : {}),
        ...(trace.progressHappened ? { progressHappened: true } : {}),
        ...(trace.isFallbackAttempt ? { isFallbackAttempt: true } : {}),
        ...(trace.suspiciousPriceClaims?.length
          ? { suspiciousPriceClaims: trace.suspiciousPriceClaims }
          : {}),
        // docs/PRD-sales-agent-sales-state-machine.md §۱۶ — فقط روی trace مسیر callSalesTurn
        ...(trace.salesStage ? { salesStage: trace.salesStage } : {}),
        ...(trace.prevSalesStage
          ? { prevSalesStage: trace.prevSalesStage }
          : {}),
        ...(trace.turnGoal ? { turnGoal: trace.turnGoal } : {}),
        ...(trace.decisionReason
          ? { decisionReason: trace.decisionReason }
          : {}),
        ...(trace.perception ? { perception: trace.perception } : {}),
        ...(trace.perceptionFailed ? { perceptionFailed: true } : {}),
        ...(trace.validatorViolations?.length
          ? {
              validatorViolations:
                trace.validatorViolations as Prisma.InputJsonValue,
            }
          : {}),
        ...(trace.correctiveRetry ? { correctiveRetry: true } : {}),
        ...(trace.candidateProductIds?.length
          ? { candidateProductIds: trace.candidateProductIds }
          : {}),
        ...(trace.quickReplies?.length
          ? { quickReplies: trace.quickReplies }
          : {}),
        voice: wantsVoice
          ? { generated: true }
          : { generated: false, reason: voiceReason },
      };
      const traceEvent = await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'AI_TRACE',
          payload: tracePayload,
        },
      });
      traceEventId = traceEvent.id;
    }

    if (wantsVoice) {
      // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — قبلاً هیچ retry خودکاری نبود (attempts پیش‌فرض Bull=۱)؛
      // یک تایم‌اوت/خطای گذرا یعنی همون یه بار شکست، تمام. حالا یک بار دیگر با ۵ ثانیه
      // تاخیر امتحان می‌شود (lockDuration پیش‌فرض صف کافی است، این job چند ثانیه طول می‌کشد نه دقیقه)
      await this.voiceQueue.add(
        'generate',
        {
          eventId: event.id,
          conversationId: conversation.id,
          text: truncateForVoice(text),
          storeCategory: conversation.store.category,
          ...(traceEventId ? { traceEventId } : {}),
          ...(getAceContext()?.engine ? { engine: getAceContext()?.engine } : {}),
        },
        { attempts: 2, backoff: { type: 'fixed', delay: 5_000 } },
      );
    }
  }

  // افزایش اتمیک با شرط سقف — دو پاسخ هم‌زمان نمی‌توانند هردو از سقف رد شوند (طبق پلن،
  // updateMany شرطی همان الگوی atomic increment رایج در Postgres/Prisma)
  private async reserveVoiceSlot(conversationId: string): Promise<boolean> {
    const result = await this.prisma.salesConversation.updateMany({
      where: {
        id: conversationId,
        voiceGenerationCount: { lt: VOICE_MAX_PER_CONVERSATION },
      },
      data: { voiceGenerationCount: { increment: 1 } },
    });
    return result.count > 0;
  }

  // همان الگوی atomic شرطی بالا — فیدبک کاربر ۱۴۰۵/۰۷/۱۲: فروشنده‌ی بدون اعتبار حداکثر
  // FREE_DAILY_QUOTA (همون عدد ۱۰ خریدار رایگان در روز، از CreditService.getFreeDailyQuota
  // خوانده می‌شود تا یک سورس بیشتر نداشته باشیم) مکالمه‌ی مجزای وویس **در روز** می‌گیرد؛ فقط
  // یک‌بار به‌ازای هر مکالمه (روی اولین وویسش) صدا زده می‌شود. برای کاربر با اعتبار خریداری‌شده
  // (billingMode === 'PAID') این تابع اصلاً صدا زده نمی‌شود (چک بالادستی در logReply) — یعنی
  // نامحدود است.
  private async reserveFreeVoiceConversationSlot(
    storeId: string,
  ): Promise<boolean> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // ریست تنبل روزانه (lazy، بدون cron) — همان الگوی snapshot/lazy-check بخش ۶.۲ سند:
    // اگر آخرین ریست قبل از امروز بوده، شمارنده صفر و تاریخ ریست به امروز می‌شود
    await this.prisma.store.updateMany({
      where: {
        id: storeId,
        OR: [
          { freeVoiceQuotaResetAt: null },
          { freeVoiceQuotaResetAt: { lt: todayStart } },
        ],
      },
      data: {
        freeVoiceConversationsUsed: 0,
        freeVoiceQuotaResetAt: todayStart,
      },
    });

    const quota = await this.creditService.getFreeDailyQuota();
    const result = await this.prisma.store.updateMany({
      where: { id: storeId, freeVoiceConversationsUsed: { lt: quota } },
      data: { freeVoiceConversationsUsed: { increment: 1 } },
    });
    return result.count > 0;
  }
}
