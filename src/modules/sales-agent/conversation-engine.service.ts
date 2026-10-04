import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import {
  generateObject,
  generateText,
  tool,
  stepCountIs,
  type UserModelMessage,
} from 'ai';
import { z } from 'zod';
import type { ConversationState, Order, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { IRAN_PROVINCES } from '../../common/constants/iran-provinces';
import { toEnglishDigits } from '../../common/utils/normalize-digits';
import { StoreKbService } from '../store/store-kb.service';
import { CardSelectorService } from '../store/card-selector.service';
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
import { AbuseGuardService } from './abuse-guard.service';
import { TelegramApiClientService } from '../telegram/telegram-api-client.service';
import { CommentsService } from '../comments/comments.service';
import { fa } from '../../i18n/fa';
import { defaultModel, resolveModel } from './model-variants';
import { toneForCategory } from './tone-by-category';
import {
  buildIntentClassificationPrompt,
  intentClassificationSchema,
} from './intent-classification.schema';
import type {
  AiTraceData,
  BuyerNeedTag,
  CartItem,
  ConversationContext,
  EngineResult,
  ParsedIntent,
  PendingVariantSelection,
  PersuasionTechnique,
  SalesAction,
  SalesAgentVoiceJobData,
  UiBlock,
} from './sales-agent.types';

export type ConversationWithStore = Prisma.SalesConversationGetPayload<{
  include: { store: true };
}>;

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱/۲ — snapshot آدرس+هزینه‌ی ارسال
// که روی Order می‌نشیند (executeCreateOrder/finalizeOrder مصرفش می‌کنند)
type AddressSnapshot = {
  recipientName: string;
  recipientPhone: string;
  province: string;
  address: string;
  postalCode: string | null;
  addressId: string | null;
  shippingCostToman: number;
};

type ProductLike = {
  id: string;
  name: string;
  basePrice: number;
  stock: number;
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
};

// محصول با گزینه فعال است یعنی حداقل یک ProductOptionType دارد — خودِ وجود واریانت‌ها هم
// همین را نشان می‌دهد، ولی optionTypes منبع واقعی تصمیم است (ممکن است فروشنده گزینه ساخته
// ولی هنوز هیچ ردیف موجودی‌دار نساخته باشد)
function hasVariantOptions(product: ProductLike): boolean {
  return (product.optionTypes?.length ?? 0) > 0;
}

// مجموع موجودی همه‌ی ترکیب‌ها — برای PRODUCT_CARD/COMPARE_CARD وقتی محصول واریانت دارد،
// چون Product.stock خودش برای محصول واریانت‌دار دیگر معنی ندارد (تصمیم §۴)
function aggregateVariantStock(product: ProductLike): number {
  return (product.variants ?? []).reduce((sum, v) => sum + v.stock, 0);
}

function displayStock(product: ProductLike): number {
  return hasVariantOptions(product)
    ? aggregateVariantStock(product)
    : product.stock;
}

// آستانه‌ی handoff: بعد از این تعداد پیام پیاپی نامفهوم/بی‌نتیجه، مکالمه به انسان سپرده
// می‌شود (طبق جدول دیسپچ پلن گام ۱) — تایمر ندارد، فقط شمارنده.
// فیدبک اول پایلوت: از ۲ به ۴ افزایش یافت — ۲ خیلی زود escalate می‌کرد، مخصوصاً وقتی خودِ
// دکمه‌های UI هم (قبل از فیکس handleAction) از مسیر NLU رد می‌شدند و گاهی نامفهوم تشخیص
// داده می‌شدند
const HANDOFF_CLARIFY_THRESHOLD = 4;

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

function truncateDescriptionForFacts(description: string): string {
  if (description.length <= DESCRIPTION_FACTS_MAX_CHARS) return description;
  return `${description.slice(0, DESCRIPTION_FACTS_MAX_CHARS)}...`;
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
function toWesternDigits(input: string): string {
  return input.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

// docs/PRD-full-agent-engineering-review.md بخش ۴/۱۱ — چک سبک، فقط observability (هرگز پاسخ
// مشتری را عوض/بلاک نمی‌کند): اگر متن نهایی یک عدد+«تومان» دارد که با هیچ‌کدام از قیمت‌های واقعی
// (محصولات دیده‌شده این نوبت، جمع سبد، مبلغ سفارش، مبلغ تخفیف) مطابقت ندارد، فقط برای لاگ ادمین
// علامت می‌خورد — چون این هیچ خط دفاعی کدمحوری نداشت، فقط یک دستورالعمل متنی «عدد اختراع نکن»
function findSuspiciousPriceClaims(
  text: string,
  knownAmounts: Set<number>,
): number[] {
  const normalized = toWesternDigits(text).replace(/[,٬]/g, '');
  const matches = normalized.matchAll(/(\d{3,})\s*تومان/g);
  const suspicious = new Set<number>();
  for (const m of matches) {
    const amount = Number(m[1]);
    if (!knownAmounts.has(amount)) suspicious.add(amount);
  }
  return [...suspicious];
}

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
    private readonly telegramApi: TelegramApiClientService,
    private readonly comments: CommentsService,
    @InjectQueue('sales-agent-voice')
    private readonly voiceQueue: Queue<SalesAgentVoiceJobData>,
  ) {}

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
        AND orders.status = 'APPROVED'
        AND (item->>'productId') != ${productId}
        AND orders.id IN (
          SELECT id FROM orders
          WHERE "storeId" = ${storeId}
            AND status = 'APPROVED'
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
        AND status = 'APPROVED'
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
    if (product.stock > 0 && product.stock <= LOW_STOCK_THRESHOLD) {
      signals.push(
        'موجودی این محصول محدود است (فقط عبارت کلی بگو، هرگز عدد دقیق)',
      );
    }
    const signalsText = signals.length
      ? ` — سیگنال‌های واقعی: ${signals.join('؛ ')}`
      : '';
    return ` [متقاعدسازی: مجاز]${signalsText}`;
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
    },
    storePersuasionEnabled: boolean,
  ): Promise<string> {
    const base = `${product.name} (شناسه: ${product.id}, ${product.basePrice} تومان)${product.stock === 0 ? ' — فعلاً ناموجود' : ''}${product.description ? ` — توضیحات: ${truncateDescriptionForFacts(product.description)}` : ''}${formatSpecsForFacts(parseProductSpecs(product.specs))}`;
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
      'PARSE_INTENT' | 'CAPTION' | 'AGENT_CAPTION' | 'SATISFACTION_CLASSIFY',
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
    const { object, usage } = await generateObject({
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
        return { intent: 'UNCLEAR' };
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
    await this.creditService.logTextUsage({
      storeId: conversation.storeId,
      customerId: conversation.customerId,
      conversationId: conversation.id,
      billingMode: conversation.billingMode,
      model,
      inputTokens,
      outputTokens,
    });
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
    const { text, usage } = await generateText({
      model: this.aiProvider.buildClient()(model),
      system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. فقط و فقط از «واقعیت‌های»
داده‌شده یک پیام فارسی کوتاه (حداکثر ۲-۳ جمله)، دوستانه و محاوره‌ای بساز — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در واقعیت‌ها نیامده اضافه نکن، و پیشنهاد بعدی اختراع نکن. هرگز تعداد دقیق موجودی
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
      text: text.trim(),
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
        return facts;
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
    const { object, usage } = await generateObject({
      model: this.aiProvider.buildClient(undefined, {
        supportsStructuredOutputs: true,
      })(model),
      schema: z.object({
        text: z.string(),
        relevantProductIds: z.array(z.string()),
      }),
      system: `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. فقط و فقط از «واقعیت‌های»
داده‌شده یک پیام فارسی کوتاه (حداکثر ۲-۳ جمله)، دوستانه و محاوره‌ای بساز — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در واقعیت‌ها نیامده اضافه نکن، و پیشنهاد بعدی اختراع نکن. هرگز تعداد دقیق موجودی
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
        return { text: facts, relevantProductIds: candidateProductIds };
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
    const { text, usage } = await generateText({
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
        return fa.salesAgent.clarifyNeedFallback;
      }
    }
  }

  private async searchProducts(storeId: string, query?: string | null) {
    // docs/PRD-telegram-bot-channel.md بخش ۹.۳ — کد محصول (روی محتوای تبلیغاتی) قبل از
    // جستجوی نام امتحان می‌شود؛ اگر دقیقاً مچ شد، فقط همان یکی برگردانده می‌شود
    if (query) {
      const exact = await this.prisma.product.findFirst({
        where: { storeId, code: { equals: query, mode: 'insensitive' } },
        include: PRODUCT_VARIANT_INCLUDE,
      });
      if (exact) return [exact];
    }
    return this.prisma.product.findMany({
      where: {
        storeId,
        ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: PRODUCT_VARIANT_INCLUDE,
    });
  }

  // docs/PRD-sales-agent-consultative-recommendation.md بخش ۳.۲ — فقط برای ابزار search_products
  // در FULL_AGENT؛ عمداً متد مشترک searchProducts بالا را دست نمی‌زند چون مسیرهای قدیمی
  // RULE_BASED/SIMPLE_AGENT (هنوز برای مکالمه‌های از قبل روی آن استراتژی زنده‌اند) هم از آن
  // استفاده می‌کنند و نباید رفتارشان بی‌سروصدا عوض شود
  private async searchProductsForConsultation(storeId: string, query: string) {
    const exact = await this.prisma.product.findFirst({
      where: { storeId, code: { equals: query, mode: 'insensitive' } },
    });
    if (exact) return [exact];

    const literalMatches = await this.prisma.product.findMany({
      where: {
        storeId,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    if (literalMatches.length > 0) return literalMatches;

    // هیچ تطابق تحت‌اللفظی‌ای نبود — احتمالاً پیام نیازمحور است، نه اسم محصول (مثل «پیجم رشد
    // نمی‌کنه»). کل کاتالوگ را تا سقف ثابت برگردان تا خودِ مدل با توضیحات واقعی هر محصول
    // استدلال کند؛ بالاتر از این سقف خارج از محدوده‌ی این طراحی است (نیاز به retrieval واقعی دارد)
    //
    // docs/PRD-full-agent-engineering-review.md بخش ۴/۹ — این سقف دقیقاً روی لبه‌ی پایینی همان
    // آستانه‌ای نشسته که PRD-sales-agent-implicit-need-detection.md گفته بود باید بازبینی شود؛
    // بدون این لاگ هیچ راهی برای فهمیدن این‌که یک فروشگاه واقعی از این سقف رد شده نبود.
    const totalActive = await this.prisma.product.count({
      where: { storeId },
    });
    if (totalActive > CONSULTATION_FULL_CATALOG_FALLBACK_CAP) {
      this.logger.warn(
        `consultation fallback cap hit: store ${storeId} has ${totalActive} ` +
          `products (cap ${CONSULTATION_FULL_CATALOG_FALLBACK_CAP}), query="${query}"`,
      );
    }
    return this.prisma.product.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: CONSULTATION_FULL_CATALOG_FALLBACK_CAP,
    });
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
          where: { id: productId },
        });
        if (!product || product.storeId !== storeId) {
          return { error: 'محصولی با این شناسه در این فروشگاه پیدا نشد' };
        }
        return {
          id: product.id,
          name: product.name,
          basePrice: product.basePrice,
          inStock: product.stock > 0,
          description: product.description
            ? truncateDescriptionForFacts(product.description)
            : null,
          specs: parseProductSpecs(product.specs),
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
          inStock: p.stock > 0,
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

    const result = await generateText({
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
        return { text: facts, relevantProductIds: candidateProductIds };
      }
    }
  }

  // docs/PRD-sales-agent-tool-calling-architecture.md — کل این بخش. برخلاف
  // callAgentCaptionWithRelevance (Track B) که فقط یک تصمیم (doBrowse) را agent-محور می‌کند،
  // این یک نوبت کامل مکالمه (سبد/سفارش/تخفیف/FAQ/ارجاع انسانی) را با یک زنجیره‌ی
  // generateText چندمرحله‌ای تصمیم می‌گیرد — جایگزین کامل parseIntent+switch+do* برای
  // مکالمه‌هایی که responseStrategy=FULL_AGENT دارند.
  private buildFullAgentSystemPrompt(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    catalogFacts: string,
    transcript: string,
    nudgeActive: boolean,
    persuasionEnabled: boolean,
    urgentDiscount: { code: string; expiresAt: Date } | null,
  ): string {
    const tone = toneForCategory(conversation.store.category);
    const store = conversation.store;
    const storeProfile = [
      store.category && `حوزه‌ی فعالیت: ${store.category}`,
      store.brandIntro && `معرفی فروشگاه: ${store.brandIntro}`,
      store.shippingInfo && `ارسال: ${store.shippingInfo}`,
      store.returnPolicy && `شرایط مرجوعی/گارانتی: ${store.returnPolicy}`,
    ]
      .filter(Boolean)
      .join('\n');
    const cartSummary = ctx.cart.length
      ? `سبد فعلی مشتری: ${ctx.cart.map((i) => `${i.name} × ${i.qty}`).join('، ')} — جمع ${this.cartTotal(ctx.cart)} تومان`
      : 'سبد فعلی مشتری خالی است.';

    return `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی و با ابزارهای زیر مستقیماً سبد/
سفارش مشتری را مدیریت می‌کنی، نه فقط متن می‌نویسی. لحن نوشتار باید ${tone} باشد.
${storeProfile ? `\nاطلاعات فروشگاه:\n${storeProfile}\n` : ''}
چند نمونه از محصولات فروشگاه (فقط چند نمونه‌ی کلی، لزوماً ربطی به بحث فعلی ندارند — برای
جست‌وجوی دقیق یا محصولی که اینجا نیست از search_products استفاده کن):
${catalogFacts}

${cartSummary}
${
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
- هرگز تعداد دقیق موجودی انبار را اعلام نکن، فقط «موجود است» یا «فعلاً ناموجود».
- اگر پیام مشتری مبهم است و اسم هیچ محصولی را نمی‌آورد (مثل «کدوم بهتره؟»، «فرقشون چیه؟»،
  «همینو بذار تو سبد»)، منظورش تقریباً همیشه «آخرین محصولاتی که مطرح/پیشنهاد شده‌اند» (بالا) یا
  تاریخچه‌ی اخیر مکالمه است — نه «چند نمونه از محصولات فروشگاه» که فقط یک نمونه‌ی کلی و تصادفی از
  کل کاتالوگ است و ممکن است هیچ ربطی به این گفتگوی خاص نداشته باشد.
- قبل از هر ادعای قیمت/موجودی/جزئیات محصولی که در کاتالوگ اولیه نبود، حتماً search_products یا
  get_product_details را صدا بزن — حدس نزن.
- افزودن/حذف واقعی از سبد فقط با update_cart انجام می‌شود؛ هرگز فقط در متن بگو «به سبد اضافه
  کردم» بدون این‌که واقعاً این ابزار را صدا زده باشی.
- ثبت نهایی سفارش فقط با create_order انجام می‌شود، و فقط وقتی مشتری صریحاً تایید خرید کرده
  (نه صرفاً علاقه نشان داده).
- اگر مشتری مشکل پرداخت یا سوال پس از خرید (مثل سفارش قبلاً ثبت‌شده) دارد که با ابزارهای بالا
  قابل‌حل نیست، یا صریح خواست با یک آدم/پشتیبان صحبت کند، request_human_handoff را صدا بزن و
  دیگر respond_to_customer را صدا نزن — مکالمه همان‌جا تمام می‌شود.
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
    }${nudgeActive ? `\n\n${OPEN_QUESTION_NUDGE_INSTRUCTION}` : ''}`;
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
            stock: p.stock,
            images: p.images,
            videos: p.videos,
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
    let ctx = this.getContext(conversation);
    const storeId = conversation.storeId;

    let mutationHappened = false;
    let progressHappened = false;
    let handoffResult: EngineResult | null = null;
    let cartResult: { cart: CartItem[]; total: number } | null = null;
    let orderResult: {
      cardNumber: string;
      ownerName: string;
      amount: number;
    } | null = null;
    let photosResult: {
      productId: string;
      productName: string;
      images: string[];
      videos: ProductVideoItem[];
    } | null = null;
    // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۶ (فاز ۴.۸، مورد ۴) — مقایسه‌ی ۲-۳ محصول
    let compareResult: {
      products: {
        id: string;
        name: string;
        basePrice: number;
        stock: number;
        specs: ProductSpecItem[];
      }[];
    } | null = null;

    const initialProducts = await this.searchProducts(storeId);
    const seenProducts = new Map<string, CompactProduct>(
      initialProducts.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          basePrice: p.basePrice,
          stock: p.stock,
          images: p.images,
          description: p.description,
          videos: parseProductVideos(p.videos),
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
    // docs/PRD-sales-agent-persuasion-principles.md بخش ۶.۳ — کلید فروشگاه؛ اگر خاموش باشد صفر
    // کوئری اضافه (نه فقط نادیده‌گرفتن) — نه findUrgentActiveDiscount صدا زده می‌شود نه
    // buildPersuasionNote چیزی برمی‌گرداند
    const storePersuasionEnabled =
      conversation.store.persuasionTechniquesEnabled;
    const catalogFacts =
      initialProducts.length === 0
        ? 'فعلاً هیچ محصولی در فروشگاه نیست.'
        : `این محصولات فروشگاه است: ${(
            await Promise.all(
              initialProducts.map((p) =>
                this.buildProductFactsLine(storeId, p, storePersuasionEnabled),
              ),
            )
          ).join('، ')}`;
    const urgentDiscount = storePersuasionEnabled
      ? await this.findUrgentActiveDiscount(storeId)
      : null;

    const transcript = await this.buildRecentTranscript(conversation.id);
    const nudgeActive =
      conversation.openQuestionStreak >= OPEN_QUESTION_NUDGE_THRESHOLD;

    const searchProductsTool = tool({
      description:
        'در کاتالوگ فروشگاه جست‌وجو می‌کند — هم روی نام هم روی توضیحات محصول. برای پیام‌های ' +
        'نیازمحور (مثل «پیجم رشد نمی‌کنه») هم کاربرد دارد، نه فقط وقتی مشتری اسم محصول را گفته؛ ' +
        'اگر هیچ تطابقی پیدا نشود کل کاتالوگ فروشگاه برگردانده می‌شود تا خودت تناسب را تشخیص بدهی.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }: { query: string }) => {
        const results = await this.searchProductsForConsultation(
          storeId,
          query,
        );
        for (const p of results) {
          seenProducts.set(p.id, {
            id: p.id,
            name: p.name,
            basePrice: p.basePrice,
            stock: p.stock,
            images: p.images,
            description: p.description,
            videos: parseProductVideos(p.videos),
          });
          toolFetchedProductIds.add(p.id);
        }
        return results.map((p) => ({
          id: p.id,
          name: p.name,
          basePrice: p.basePrice,
          inStock: p.stock > 0,
          description: p.description
            ? truncateDescriptionForFacts(p.description)
            : null,
          specs: parseProductSpecs(p.specs),
        }));
      },
    });

    const getProductDetailsTool = tool({
      description:
        'جزئیات کامل یک محصول (توضیحات کامل، قیمت، موجودی) را با شناسه‌اش برمی‌گرداند',
      inputSchema: z.object({ productId: z.string() }),
      execute: async ({ productId }: { productId: string }) => {
        const product = await this.prisma.product.findUnique({
          where: { id: productId },
        });
        if (!product || product.storeId !== storeId) {
          return { error: 'محصولی با این شناسه در این فروشگاه پیدا نشد' };
        }
        seenProducts.set(product.id, {
          id: product.id,
          name: product.name,
          basePrice: product.basePrice,
          stock: product.stock,
          images: product.images,
          description: product.description,
          videos: parseProductVideos(product.videos),
        });
        toolFetchedProductIds.add(product.id);
        const persuasionNote = await this.buildPersuasionNote(
          storeId,
          product,
          storePersuasionEnabled,
        );
        return {
          id: product.id,
          name: product.name,
          basePrice: product.basePrice,
          inStock: product.stock > 0,
          description: product.description
            ? truncateDescriptionForFacts(product.description)
            : null,
          specs: parseProductSpecs(product.specs),
          ...(persuasionNote ? { persuasion: persuasionNote.trim() } : {}),
        };
      },
    });

    const updateCartTool = tool({
      description:
        'محصولی را به سبد مشتری اضافه یا از آن حذف می‌کند — تنها راه واقعی تغییر سبد، تغییر فقط در متن کافی نیست',
      inputSchema: z.object({
        productId: z.string(),
        qty: z.number().optional(),
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
        const product = await this.prisma.product.findUnique({
          where: { id: productId },
        });
        if (!product || product.storeId !== storeId) {
          return { error: 'محصولی با این شناسه در این فروشگاه پیدا نشد' };
        }
        // docs/PRD-product-display-focus-and-variations.md §۴.۴ — مسیر FULL_AGENT فعلاً فعال
        // نیست (pickResponseStrategy همیشه RULE_BASED برمی‌گرداند)؛ فاز ۱ واریانت را به این
        // ابزار گسترش نمی‌دهد، اگر/وقتی فعال شد باید جداگانه اضافه شود
        const mutation = this.computeCartMutation(
          ctx.cart,
          product,
          null,
          qty ?? 1,
          !!remove,
        );
        if (!mutation.ok) {
          return { error: 'موجودی این محصول کافی نیست' };
        }
        // بخش ۱.۳/۱.۴ docs/PRD-full-agent-engineering-review.md — ترتیب عمداً برعکس شد: قبلاً
        // ctx/mutationHappened قبل از تایید persist ست می‌شدند؛ اگر persistTransition throw
        // می‌کرد (خطای گذرای DB)، SDK خطا را به مدل برمی‌گرداند و مدل می‌توانست دوباره همین ابزار
        // را صدا بزند، این‌بار روی ctx ای که از قبل (بدون persist موفق) تغییر کرده بود — یعنی
        // تعداد می‌توانست دوبرابر شود. حالا دقیقاً مثل cancel_order/request_human_handoff: فقط
        // بعد از موفقیت persist، ctx/مینی‌حالت لوکال آپدیت می‌شوند.
        const nextCtx = { ...ctx, cart: mutation.cart };
        await this.persistTransition(conversation, 'CART_REVIEW', nextCtx);
        ctx = nextCtx;
        mutationHappened = true;
        await this.resetClarifyAttempts(conversation);
        const total = this.cartTotal(ctx.cart);
        cartResult = { cart: ctx.cart, total };
        if (!remove) progressHappened = true;
        return {
          cart: ctx.cart.map((i) => ({
            name: i.name,
            qty: i.qty,
            unitPrice: i.unitPrice,
          })),
          total,
        };
      },
    });

    const viewCartTool = tool({
      description: 'محتوای فعلی سبد مشتری را برمی‌گرداند',
      inputSchema: z.object({}),
      execute: () => {
        const total = this.cartTotal(ctx.cart);
        cartResult = { cart: ctx.cart, total };
        return {
          cart: ctx.cart.map((i) => ({
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
        const preview = await this.previewDiscount(storeId, ctx.cart, code);
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
          ...ctx,
          appliedDiscount: {
            id: preview.id,
            code: preview.code,
            amountToman: preview.amountToman,
          },
        };
        await this.persistTransition(conversation, 'CART_REVIEW', nextCtx);
        ctx = nextCtx;
        mutationHappened = true;
        return { amountToman: preview.amountToman, newTotal: preview.newTotal };
      },
    });

    const createOrderTool = tool({
      description:
        'سفارش نهایی را از روی سبد فعلی ثبت می‌کند و اطلاعات واقعی پرداخت را برمی‌گرداند — فقط بعد از تایید صریح مشتری صدا بزن',
      inputSchema: z.object({}),
      execute: async () => {
        const created = await this.executeCreateOrder(conversation, ctx);
        if (created.empty) {
          return { error: 'سبد خالی است، چیزی برای ثبت سفارش نیست' };
        }
        mutationHappened = true;
        progressHappened = true;
        orderResult = {
          cardNumber: created.cardNumber,
          ownerName: created.ownerName,
          amount: created.order.totalAmount,
        };
        return {
          amount: created.order.totalAmount,
          cardNumber: created.cardNumber,
          ownerName: created.ownerName,
        };
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
        ctx = await this.resetCartState(conversation, ctx);
        mutationHappened = true;
        cartResult = { cart: [], total: 0 };
        return { ok: true };
      },
    });

    const answerFaqTool = tool({
      description:
        'جواب واقعی یک سؤال (باکس دانش فروشگاه / توضیح محصولات اخیر / پروفایل فروشگاه) را جست‌وجو می‌کند',
      inputSchema: z.object({ question: z.string() }),
      execute: async ({ question }: { question: string }) => {
        const found = await this.findFaqAnswer(conversation, ctx, question);
        return found ?? { matched: false };
      },
    });

    const requestHumanHandoffTool = tool({
      description:
        'مکالمه را به یک فروشنده‌ی انسانی ارجاع می‌دهد — برای درخواست صریح صحبت با انسان یا مشکلاتی (پرداخت/پس از خرید) که ابزاری برای حلش نداری',
      inputSchema: z.object({ reason: z.string().optional() }),
      execute: async () => {
        handoffResult = await this.transitionToHandoff(
          conversation,
          'CUSTOMER_REQUESTED',
        );
        mutationHappened = true;
        return { done: true };
      },
    });

    const showProductPhotosTool = tool({
      description:
        'همه‌ی عکس‌های یک محصول را برمی‌گرداند — برای درخواست صریح عکس بیشتر',
      inputSchema: z.object({ productId: z.string() }),
      execute: async ({ productId }: { productId: string }) => {
        const product = await this.prisma.product.findUnique({
          where: { id: productId },
        });
        if (
          !product ||
          product.storeId !== storeId ||
          product.images.length === 0
        ) {
          return { error: 'عکسی برای این محصول پیدا نشد' };
        }
        photosResult = {
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
          where: { id: { in: productIds }, storeId },
        });
        for (const p of products) {
          seenProducts.set(p.id, {
            id: p.id,
            name: p.name,
            basePrice: p.basePrice,
            stock: p.stock,
            images: p.images,
            description: p.description,
            videos: parseProductVideos(p.videos),
          });
          toolFetchedProductIds.add(p.id);
        }
        compareResult = {
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            basePrice: p.basePrice,
            stock: p.stock,
            specs: parseProductSpecs(p.specs),
          })),
        };
        return compareResult;
      },
    });

    // بدون execute — دقیقاً مثل respond_to_customer در callAgentCaptionWithRelevance (Track B)،
    // حلقه‌ی چندمرحله‌ای SDK بعد از این فراخوان خودش متوقف می‌شود
    //
    // docs/PRD-sales-agent-persuasion-principles.md بخش ۸ — دو فیلد خوداظهاری متقاعدسازی فقط
    // وقتی storePersuasionEnabled باشد به schema اضافه می‌شوند؛ تست زنده نشان داد وقتی این فیلدها
    // همیشه اجباری بمانند ولی PERSUASION_INSTRUCTION (تعریف ۶ اصل) اصلاً در پرامپت نیست، مدل
    // مجبور به حدس‌زدن کورکورانه می‌شود و برچسب‌های غلط/بی‌ربط (مثلاً AUTHORITY بدون هیچ ادعای
    // واقعی) می‌سازد — پس وقتی خاموش است، این فیلدها اصلاً در schema نیستند، نه فقط optional
    const respondToCustomer = tool({
      description:
        'پاسخ نهایی به مشتری را اعلام می‌کند — دقیقاً یک‌بار، به‌عنوان آخرین قدم (مگر وقتی request_human_handoff زده‌ای)',
      inputSchema: storePersuasionEnabled
        ? z.object({
            text: z
              .string()
              .describe('متن فارسی کوتاه (حداکثر ۲-۳ جمله) برای مشتری'),
            relevantProductIds: z
              .array(z.string())
              .describe(
                'شناسه‌ی محصول(های) واقعاً مرتبط برای نمایش کارت — اگر موضوعی ندارد خالی بگذار',
              ),
            // برای لاگ ادمین؛ خوداظهاری خودِ مدل، نه چیزی که سرور بتواند مستقل از متن تشخیص دهد
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
          })
        : z.object({
            text: z
              .string()
              .describe('متن فارسی کوتاه (حداکثر ۲-۳ جمله) برای مشتری'),
            relevantProductIds: z
              .array(z.string())
              .describe(
                'شناسه‌ی محصول(های) واقعاً مرتبط برای نمایش کارت — اگر موضوعی ندارد خالی بگذار',
              ),
          }),
    });

    // docs/PRD-full-agent-engineering-review.md بخش ۵ — قبلاً factsOrPrompt لاگ‌شده در AI_TRACE
    // برای FULL_AGENT فقط دوباره‌ی customerMessage بود (برچسب «نمایش کامل prompt/facts» در ادمین
    // گمراه‌کننده بود)؛ حالا متن واقعی پرامپت سیستم همین‌جا یک‌بار ساخته و هم به generateText هم
    // به logReply پاس داده می‌شود
    const systemPrompt = this.buildFullAgentSystemPrompt(
      conversation,
      ctx,
      catalogFacts,
      transcript,
      nudgeActive,
      storePersuasionEnabled,
      urgentDiscount,
    );

    let result;
    try {
      result = await generateText({
        model: this.aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(model),
        tools: {
          search_products: searchProductsTool,
          get_product_details: getProductDetailsTool,
          update_cart: updateCartTool,
          view_cart: viewCartTool,
          apply_discount: applyDiscountTool,
          create_order: createOrderTool,
          cancel_order: cancelOrderTool,
          answer_faq: answerFaqTool,
          request_human_handoff: requestHumanHandoffTool,
          show_product_photos: showProductPhotosTool,
          compare_products: compareProductsTool,
          respond_to_customer: respondToCustomer,
        },
        // docs/PRD-sales-agent-tool-calling-architecture.md بخش ۲.۳ — سقف هزینه‌ی فروشنده:
        // تعداد قدم ابزار در هر نوبت محدود است، نه بی‌نهایت (Track B مشابه از ۴ استفاده می‌کند؛
        // اینجا چون کل مکالمه‌ست نه فقط doBrowse، کمی بیشتر لازم است)
        stopWhen: stepCountIs(6),
        system: systemPrompt,
        prompt: customerMessage,
        temperature: 0.3,
      });
    } catch (err) {
      // بخش ۱.۱/۱.۴ docs/PRD-full-agent-engineering-review.md — یافته‌ی بحرانی: قبلاً این
      // generateText هیچ try/catch نداشت. اگر قدم اول همین نوبت یک جهش واقعی را با موفقیت persist
      // می‌کرد (مثلاً create_order/update_cart) ولی قدم دوم به بعد (rate limit، تایم‌اوت، ۵xx بعد
      // از تمام‌شدن retry داخلی SDK) throw می‌کرد، این throw مستقیم از اینجا خارج می‌شد، از کنار
      // چک mutationHappened پایین رد می‌شد (چون اصلاً به آن خط نمی‌رسید)، و به catch خالی
      // runFullAgentTurn می‌رسید — جایی که اصلاً خبر نداشت جهشی رخ داده. نتیجه: یا retry کامل حلقه
      // با مدل دیگر (ریسک دوبار افزودن به سبد/دوبار سفارش)، یا یک پیام عمومی «متوجه نشدم» بدون
      // هیچ اشاره‌ای به جهشی که واقعاً در DB ثبت شده بود. حالا دقیقاً همان مسیر salvage که برای
      // نبودن respond_to_customer طراحی شده بود، برای این throw هم صدا زده می‌شود — بدون رسیدن به
      // catch بیرونی runFullAgentTurn و بدون retry کامل حلقه.
      if (handoffResult) {
        return {
          engineResult: handoffResult,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      if (mutationHappened) {
        const engineResult = await this.salvageReplyAfterMutation(
          conversation,
          orderResult,
          cartResult,
        );
        return {
          engineResult,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
      throw err;
    }

    if (handoffResult) {
      return {
        engineResult: handoffResult,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
      };
    }

    const finalCall = result.toolCalls.find(
      (c) => c.toolName === 'respond_to_customer',
    ) as
      | {
          input: {
            text: string;
            relevantProductIds: string[];
            persuasionTechniquesUsed?: PersuasionTechnique[];
            usedGeneralKnowledge?: boolean;
          };
        }
      | undefined;

    if (!finalCall) {
      if (mutationHappened) {
        const engineResult = await this.salvageReplyAfterMutation(
          conversation,
          orderResult,
          cartResult,
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

    // docs/PRD-full-agent-engineering-review.md بخش ۵ — برای AI_TRACE ادمین؛ همه‌ی ابزارهایی
    // که همین نوبت واقعاً صدا زده شدند (respond_to_customer جدا هم به‌عنوان text/relevantProductIds
    // ثبت می‌شود، پس اینجا تکرار نمی‌شود) — نشان می‌دهد مدل واقعاً جست‌وجو کرده یا از حافظه جواب داده
    const toolsCalled = result.toolCalls
      .filter((c) => c.toolName !== 'respond_to_customer')
      .map((c) => ({ name: c.toolName, args: c.input }));

    const text = finalCall.input.text.trim();
    const relevantProductIds = finalCall.input.relevantProductIds ?? [];

    // بخش ۴/۱۱ docs/PRD-full-agent-engineering-review.md — جمع تمام مبلغ‌های واقعی این نوبت
    // (قیمت محصولات دیده‌شده، جمع/تک‌تک آیتم‌های سبد، مبلغ سفارش، مبلغ تخفیف) برای چک سبک پایین
    const knownAmounts = new Set<number>();
    for (const p of seenProducts.values()) knownAmounts.add(p.basePrice);
    for (const item of ctx.cart) {
      knownAmounts.add(item.unitPrice);
      knownAmounts.add(item.unitPrice * item.qty);
    }
    knownAmounts.add(this.cartTotal(ctx.cart));
    // نکته‌ی TS: چون cartResult/orderResult فقط داخل closure ابزارها reassign می‌شوند، کامپایلر
    // تایپ آن‌ها را در این نقطه (خارج از closure) فقط «null» می‌بیند و هر narrowing مستقیم را به
    // never می‌رساند — cast صریح به تایپ اعلان‌شده این مشکل را دور می‌زند
    const cartResultTotal = (
      cartResult as { cart: CartItem[]; total: number } | null
    )?.total;
    if (cartResultTotal !== undefined) knownAmounts.add(cartResultTotal);
    const orderResultAmount = (
      orderResult as {
        cardNumber: string;
        ownerName: string;
        amount: number;
      } | null
    )?.amount;
    if (orderResultAmount !== undefined) knownAmounts.add(orderResultAmount);
    if (ctx.appliedDiscount) knownAmounts.add(ctx.appliedDiscount.amountToman);
    const suspiciousPriceClaims = findSuspiciousPriceClaims(text, knownAmounts);
    if (suspiciousPriceClaims.length) {
      this.logger.warn(
        `suspicious price claim in FULL_AGENT reply: conversation ${conversation.id}, ` +
          `amounts=[${suspiciousPriceClaims.join(', ')}], text="${text}"`,
      );
    }

    const uiBlock = this.deriveFullAgentUiBlock({
      orderResult,
      cartResult,
      photosResult,
      compareResult,
      relevantProductIds,
      seenProducts,
      toolFetchedProductIds,
    });

    // باگ واقعی زنده (۱۴۰۵/۰۷/۱۹): FULL_AGENT هیچ‌وقت ctx.lastShownProducts را نمی‌نوشت (برخلاف
    // مسیر قدیمی RULE_BASED که همین فیلد را دقیقاً برای همین مشکل دارد) — یعنی «کاتالوگ اولیه»ی
    // هر نوبت (۵ محصول با جدیدترین createdAt، کاملاً بی‌ربط به روند گفتگو) تنها منبع ساختاریافته‌ی
    // باقی‌مانده بود. وقتی مشتری با یک پیام مبهم («کدوم بهتره؟») بدون اسم محصول ادامه می‌داد، مدل
    // به‌جای کندوکاو در متن خام تاریخچه، به همین کاتالوگ بی‌ربط برمی‌گشت — دیده‌شده زنده: مشتری
    // داشت بین دو غذای سگ مقایسه می‌کرد، مدل ناگهان رفت سراغ دان پرنده.
    //
    // فیکس اول (ناکافی، دیده شد با تست زنده): صرفاً فیلتر با seenProducts کافی نیست، چون
    // seenProducts همیشه شامل همان کاتالوگ اولیه‌ی بی‌ربط هم هست — تست زنده نشان داد مدل گاهی
    // relevantProductIds را به شناسه‌ی محصولی می‌دهد که اصلاً در متن پاسخش نیامده، فقط چون در
    // کاتالوگ اولیه بوده. فیکس نهایی: فقط محصولاتی که همین نوبت واقعاً با search_products/
    // get_product_details صدا زده شده‌اند (toolFetchedProductIds) واجد شرایط lastShownProducts اند.
    const lastShownProducts = relevantProductIds
      .filter((id) => toolFetchedProductIds.has(id))
      .map((id) => seenProducts.get(id))
      .filter((p): p is CompactProduct => !!p)
      .map((p) => ({ id: p.id, name: p.name }));

    // docs/PRD-sales-agent-tool-calling-architecture.md بخش ۴.۱/۴.۲ — سرور-محور، نه خوداظهاری
    // مدل: فقط update_cart(موفق،remove=false)/create_order موفق «پیشرفت» حساب می‌شود
    await this.prisma.salesConversation.update({
      where: { id: conversation.id },
      data: {
        ...(progressHappened
          ? { openQuestionStreak: 0 }
          : { openQuestionStreak: { increment: 1 } }),
        ...(lastShownProducts.length
          ? { contextData: { ...ctx, lastShownProducts } }
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
      relevantProductIdsRaw: relevantProductIds,
      lastShownProducts,
      toolsCalled,
      initialCatalogProductIds: initialProducts.map((p) => p.id),
      stepsUsed: result.steps.length,
      mutationHappened,
      progressHappened,
      isFallbackAttempt,
      ...(suspiciousPriceClaims.length ? { suspiciousPriceClaims } : {}),
    });

    return {
      engineResult: {
        reply: text,
        uiBlocks: [uiBlock],
        state: conversation.currentState,
      },
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
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
    const primaryModel = resolveModel(conversation.abVariant);
    const started = Date.now();
    try {
      const { engineResult, inputTokens, outputTokens } =
        await this.callFullAgentTurn(conversation, text, primaryModel);
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
        const { engineResult, inputTokens, outputTokens } =
          await this.callFullAgentTurn(
            conversation,
            text,
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
        return this.doClarifyUnclear(conversation);
      }
    }
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

  async handleMessage(
    conversation: ConversationWithStore,
    text: string,
  ): Promise<EngineResult> {
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'CUSTOMER_MESSAGE',
        payload: { text },
      },
    });

    const abuseResult = await this.checkAbuseGuard(conversation);
    if (abuseResult) return abuseResult;

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
      return this.doSubmitComment(conversation, text);
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
    // می‌ماند، فقط برای مکالمه‌های FULL_AGENT اصلاً اجرا نمی‌شود (هیچ مکالمه‌ی واقعی تصادفی به
    // اینجا نمی‌رسد چون pickResponseStrategy هنوز همیشه RULE_BASED برمی‌گرداند)
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
        where: { id: ctx.anchoredProductId },
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
      ? await this.prisma.product.findUnique({ where: { id: ref.id } })
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
  private async doSubmitComment(
    conversation: ConversationWithStore,
    text: string,
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
      text,
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
    const { object, usage } = await generateObject({
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
    const primaryModel = resolveModel(conversation.abVariant);
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
        return 'UNRELATED';
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
  async handleAction(
    conversation: ConversationWithStore,
    action: SalesAction,
  ): Promise<EngineResult> {
    const abuseResult = await this.checkAbuseGuard(conversation);
    if (abuseResult) return abuseResult;

    if (this.billingBlocked(conversation)) {
      return this.transitionToHandoff(conversation, 'BILLING_BLOCKED');
    }

    const ctx = this.getContext(conversation);

    if (action.type === 'ADD_TO_CART') {
      const product = action.productId
        ? await this.prisma.product.findUnique({
            where: { id: action.productId },
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
        return this.doClarify(conversation, fa.salesAgent.productNotFound);
      }
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'CUSTOMER_MESSAGE',
          payload: { text: fa.salesAgent.addToCartActionNamed(product.name) },
        },
      });
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
      );
    }

    // docs/PRD-product-display-focus-and-variations.md §۴.۲ — جواب چیپ VARIANT_PROMPT (مسیر
    // دکمه، معادل دکمه‌ای مسیر متنی handleVariantSelectionInput)
    if (action.type === 'SELECT_VARIANT_VALUE') {
      if (!ctx.pendingVariantSelection || !action.value) {
        return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
      }
      return this.resolveVariantSelectionValue(
        conversation,
        ctx,
        action.value,
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
      return this.advanceAddressStep(
        conversation,
        ctx,
        'name',
        {},
        fa.salesAgent.addressAskName,
      );
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
            where: { id: action.productId },
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
        })),
      };
      const reply = orders.length
        ? await this.caption(
            `سفارش‌های قبلی مشتری: ${orders
              .map((o) => `${(o.items as CartItem[]).map((i) => i.name).join('، ')} (${o.status})`)
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
      let cart = ctx.cart;
      let anyAdded = false;
      for (const item of order.items as CartItem[]) {
        const product = await this.prisma.product.findUnique({
          where: { id: item.productId },
        });
        if (!product || product.storeId !== conversation.storeId) continue;
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
      const nextState: ConversationState = 'CART_REVIEW';
      await this.persistTransition(conversation, nextState, { ...ctx, cart });
      await this.resetClarifyAttempts(conversation);
      const uiBlock: UiBlock = {
        type: 'CART_SUMMARY',
        items: cart,
        total: this.cartTotal(cart),
      };
      const facts = `سبد فعلی: ${cart.map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.qty}`).join('، ')} — جمع کل ${this.cartTotal(cart)} تومان`;
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
      where: { id: active.productId },
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
    const facts = `مشتری از لینک مستقیم این محصول وارد شده: ${product.name} (${product.basePrice} تومان)${product.stock === 0 ? ' — فعلاً ناموجود' : ''}${hasVariantOptions(product) ? ` — این محصول گزینه‌های مختلف (${product.optionTypes!.map((o) => o.name).join('/')}) دارد` : ''}${product.description ? `\nتوضیحات محصول: ${truncateDescriptionForFacts(product.description)}` : ''}${formatSpecsForFacts(parseProductSpecs(product.specs))}${await this.commentsFactsSuffix(product.id)}${await this.crossSellFactsSuffix(conversation.storeId, product.id)}`;
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
      return this.doClarify(conversation, fa.salesAgent.noProductsFound);
    }

    const isFirstReply = conversation.currentState === 'GREETING';

    // همون دلیل showProduct بالا — بدون عدد موجودی در واقعیت‌ها. hasVariantOptions هم همان‌جا
    // توضیح داده شد: فقط یک اشاره‌ی کوتاه که این محصول گزینه دارد، بدون جزئیات
    const facts = `این محصولات فروشگاه است: ${products.map((p) => `${p.name} (${p.basePrice} تومان)${p.stock === 0 ? ' — فعلاً ناموجود' : ''}${hasVariantOptions(p) ? ` — دارای گزینه‌های مختلف (${p.optionTypes!.map((o) => o.name).join('/')})` : ''}${p.description ? ` — توضیحات: ${truncateDescriptionForFacts(p.description)}` : ''}${formatSpecsForFacts(parseProductSpecs(p.specs))}`).join('، ')}`;

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
    if (!['BROWSING', 'CART_REVIEW'].includes(conversation.currentState)) {
      return this.doClarify(conversation, fa.salesAgent.nothingToConfirm);
    }

    const ref = this.resolveProductRef(ctx, parsed);
    const product = ref
      ? await this.prisma.product.findUnique({
          where: { id: ref.id },
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

    const availableStock = variant ? variant.stock : product.stock;
    if (availableStock < qty) return { ok: false };
    const unitPrice = variant?.priceOverride ?? product.basePrice;
    const existingIdx = next.findIndex(
      (i) =>
        i.productId === product.id &&
        (i.variantId ?? null) === (variant?.id ?? null),
    );
    if (existingIdx >= 0) {
      next[existingIdx] = {
        ...next[existingIdx],
        qty: next[existingIdx].qty + qty,
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

    const nextState: ConversationState = 'CART_REVIEW';
    // pendingVariantSelection همیشه اینجا پاک می‌شود — چه از مسیر واریانت رسیده باشیم چه نه
    await this.persistTransition(conversation, nextState, {
      ...ctx,
      cart,
      pendingVariantSelection: null,
    });
    await this.resetClarifyAttempts(conversation);

    const uiBlock: UiBlock = {
      type: 'CART_SUMMARY',
      items: cart,
      total: this.cartTotal(cart),
    };
    const facts = cart.length
      ? `سبد فعلی: ${cart.map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.qty}`).join('، ')} — جمع کل ${this.cartTotal(cart)} تومان\n${fa.salesAgent.discountAppliedHint}`
      : fa.salesAgent.cartEmpty;
    const reply = await this.caption(facts, conversation);
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
    const uiBlock: UiBlock = {
      type: 'CART_SUMMARY',
      items: ctx.cart,
      total: this.cartTotal(ctx.cart),
    };
    const facts = ctx.cart.length
      ? `سبد فعلی: ${ctx.cart.map((i) => `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.qty}`).join('، ')} — جمع کل ${this.cartTotal(ctx.cart)} تومان`
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
      values: optionType.values.map((v) => ({ label: v.value, value: v.value })),
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

  // از handleAction (ADD_TO_CART روی محصول دارای گزینه) و doUpdateCart (مسیر NLU) صدا زده
  // می‌شود — همیشه از بُعد اول (position=0) شروع می‌کند
  private async startVariantSelection(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    product: ProductLike,
    qty: number,
  ): Promise<EngineResult> {
    const firstOptionType = product.optionTypes![0];
    const pendingVariantSelection: PendingVariantSelection = {
      productId: product.id,
      qty,
      selectedValues: {},
      mode: 'DIMENSION',
    };
    await this.persistTransition(conversation, conversation.currentState, {
      ...ctx,
      pendingVariantSelection,
    });
    const uiBlock = this.buildVariantDimensionPrompt(product, firstOptionType, {});
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
      where: { id: pending.productId },
      include: PRODUCT_VARIANT_INCLUDE,
    });
    if (!product) {
      await this.persistTransition(conversation, conversation.currentState, {
        ...ctx,
        pendingVariantSelection: null,
      });
      return this.doClarify(conversation, fa.salesAgent.productNotFound);
    }

    if (pending.mode === 'ALTERNATIVES') {
      const alternatives = product.variants!.filter((v) => v.stock > 0);
      const uiBlock = this.buildVariantAlternativesPrompt(product, alternatives);
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
      return this.finalizeVariantSelection(
        conversation,
        ctx,
        product,
        pending,
      );
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
      where: { id: pending.productId },
      include: PRODUCT_VARIANT_INCLUDE,
    });
    if (!product) {
      await this.persistTransition(conversation, conversation.currentState, {
        ...ctx,
        pendingVariantSelection: null,
      });
      return this.doClarify(conversation, fa.salesAgent.productNotFound);
    }

    if (pending.mode === 'ALTERNATIVES') {
      const variant = product.variants!.find(
        (v) => v.id === rawValue && v.stock > 0,
      );
      if (!variant) {
        // همین الان یکی دیگر خریده بود (race) یا دکمه‌ی قدیمی — لیست موجود را تازه نشان می‌دهیم
        const alternatives = product.variants!.filter((v) => v.stock > 0);
        if (alternatives.length === 0) {
          await this.persistTransition(conversation, conversation.currentState, {
            ...ctx,
            pendingVariantSelection: null,
          });
          const reply = fa.salesAgent.variantNoAlternatives;
          await this.logReply(conversation, reply, { type: 'NONE' });
          return { reply, uiBlocks: [{ type: 'NONE' }], state: conversation.currentState };
        }
        const uiBlock = this.buildVariantAlternativesPrompt(product, alternatives);
        const reply = fa.salesAgent.variantOutOfStockAlternatives;
        await this.logReply(conversation, reply, uiBlock);
        return { reply, uiBlocks: [uiBlock], state: conversation.currentState };
      }
      return this.applyCartUpdate(
        conversation,
        ctx,
        product,
        { id: variant.id, optionValues: this.optionValuesOf(variant), priceOverride: variant.priceOverride, stock: variant.stock },
        pending.qty,
        false,
        'ADD_TO_CART',
      );
    }

    const optionType = this.firstUnresolvedOptionType(
      product,
      pending.selectedValues,
    );
    if (!optionType) {
      return this.finalizeVariantSelection(conversation, ctx, product, pending);
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
    return this.finalizeVariantSelection(conversation, ctx, product, {
      ...pending,
      selectedValues: nextSelectedValues,
    });
  }

  // docs/PRD-product-display-focus-and-variations.md §۴.۳ — همه‌ی ابعاد مشخص شدند؛ یا ترکیب
  // دقیقاً موجود پیدا می‌شود و مستقیم به سبد اضافه می‌شود، یا (موجودی لحظه‌ای تمام‌شده) لیست
  // ترکیب‌های واقعاً موجود نشان داده می‌شود — هرگز حدس یا موجودی فرضی
  private async finalizeVariantSelection(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    product: ProductLike,
    pending: PendingVariantSelection,
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
      return { reply, uiBlocks: [{ type: 'NONE' }], state: conversation.currentState };
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

  // منطق خالص DB (بدون caption/logReply) — docs/PRD-sales-agent-tool-calling-architecture.md
  // بخش ۳.۳ (ابزار create_order) هم عیناً همین تابع را صدا می‌زند، نه این‌که idempotency/چرخش
  // کارت/کسر اتمیک تخفیف را بازنویسی کند
  private async executeCreateOrder(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    addressSnapshot?: AddressSnapshot,
  ): Promise<
    | { empty: true }
    | { empty: false; order: Order; cardNumber: string; ownerName: string }
  > {
    if (ctx.cart.length === 0) {
      return { empty: true };
    }

    // idempotent: اگر سفارش این مکالمه از قبل هست، همان را برمی‌گرداند (بدون ساخت تکراری)
    let order = await this.prisma.order.findUnique({
      where: { conversationId: conversation.id },
    });
    let cardNumber: string;
    let ownerName: string;
    if (!order) {
      const cartTotal = this.cartTotal(ctx.cart);
      // docs/PRD-customer-comments-and-discounts.md بخش ۹ — مصرف واقعی کد تخفیف همین‌جا،
      // نه در doApplyDiscount (پیش‌نمایش)؛ UPDATE شرطی خام (نه updateMany) چون شرط سقف
      // (redemptionCount < maxRedemptions) مقایسه‌ی دو ستون همین ردیف است — چیزی که فیلتر
      // Prisma نمی‌تواند بدون رفتن به raw SQL بیان کند. لاک ردیف پستگرس خودش اتمیک‌بودن را
      // تضمین می‌کند: دو خریدار هم‌زمان نمی‌توانند هردو از آخرین ظرفیت کد استفاده کنند.
      let discountAmount = 0;
      let discountCodeId: string | undefined;
      if (ctx.appliedDiscount) {
        const affected = await this.prisma.$executeRaw`
          UPDATE store_discount_codes
          SET "redemptionCount" = "redemptionCount" + 1
          WHERE id = ${ctx.appliedDiscount.id}
            AND "isActive" = true
            AND ("maxRedemptions" IS NULL OR "redemptionCount" < "maxRedemptions")
        `;
        if (affected > 0) {
          discountAmount = ctx.appliedDiscount.amountToman;
          discountCodeId = ctx.appliedDiscount.id;
        }
      }
      // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ — هزینه‌ی ارسال همین‌جا
      // به مجموع اضافه می‌شود (نه بعداً روی پرداخت)؛ shippingCostToman جدا هم ذخیره می‌شود
      // فقط برای شفافیت/نمایش
      const total =
        cartTotal - discountAmount + (addressSnapshot?.shippingCostToman ?? 0);
      // docs/PRD-seller-multi-bank-card-rotation.md بخش ۲ — انتخاب دقیقاً همین لحظه، یک‌بار،
      // و روی خودِ سفارش پرسیست می‌شود (بازخوانی بعدی همین سفارش دوباره انتخاب نمی‌کند)
      const card = await this.cardSelector.selectCard(conversation.storeId);
      order = await this.prisma.order.create({
        data: {
          storeId: conversation.storeId,
          conversationId: conversation.id,
          items: ctx.cart,
          totalAmount: total,
          bankCardId: card.id,
          discountCodeId,
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
      cardNumber = card.cardNumber;
      ownerName = card.ownerName;
    } else if (order.bankCardId) {
      const card = await this.prisma.storeBankCard.findUnique({
        where: { id: order.bankCardId },
      });
      cardNumber = card?.cardNumber ?? conversation.store.bankCardNumber;
      ownerName = card?.ownerName ?? conversation.store.bankOwnerName;
    } else {
      cardNumber = conversation.store.bankCardNumber;
      ownerName = conversation.store.bankOwnerName;
    }

    const nextState: ConversationState = 'AWAITING_PAYMENT';
    await this.persistTransition(conversation, nextState, ctx, 'createOrder');

    return { empty: false, order, cardNumber, ownerName };
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

  // قبلاً تمام بدنه‌ی doCreateOrder همین بود؛ استخراج شد تا هم از مسیر بدون‌آدرس بالا هم از
  // انتهای فلوی ADDRESS_COLLECTION (finalizeAddressOrder) صدا زده شود
  private async finalizeOrder(
    conversation: ConversationWithStore,
    ctx: ConversationContext,
    addressSnapshot?: AddressSnapshot,
  ): Promise<EngineResult> {
    const created = await this.executeCreateOrder(
      conversation,
      ctx,
      addressSnapshot,
    );
    if (created.empty) {
      return this.doClarify(conversation, fa.salesAgent.cartEmpty);
    }

    const uiBlock: UiBlock = {
      type: 'PAYMENT_INSTRUCTIONS',
      cardNumber: created.cardNumber,
      ownerName: created.ownerName,
      amount: created.order.totalAmount,
    };
    const facts = `سفارش ثبت شد. مبلغ قابل پرداخت ${created.order.totalAmount} تومان${
      addressSnapshot?.shippingCostToman
        ? ` (شامل ${addressSnapshot.shippingCostToman.toLocaleString('fa-IR')} تومان هزینه ارسال)`
        : ''
    } به شماره کارت ${created.cardNumber} به نام ${created.ownerName}. بعد از واریز، عکس رسید را بفرست.`;
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
      return this.advanceAddressStep(
        conversation,
        ctx,
        'name',
        {},
        fa.salesAgent.addressAskName,
      );
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
        const digits = toEnglishDigits(trimmed).replace(/[\s-]/g, '');
        if (!/^(\+98|0)?9[0-9]{9}$/.test(digits)) {
          return this.doClarify(
            conversation,
            fa.salesAgent.addressPhoneInvalid,
          );
        }
        return this.promptProvinceSelection(conversation, ctx, {
          ...pending,
          recipientPhone: digits,
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

  async handleReceiptUpload(
    conversation: ConversationWithStore,
    receiptImageKey: string,
  ): Promise<EngineResult> {
    const order = await this.prisma.order.findUnique({
      where: { conversationId: conversation.id },
    });
    if (!order || conversation.currentState !== 'AWAITING_PAYMENT') {
      return this.doClarify(conversation, fa.salesAgent.noPendingOrder);
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { receiptImageKey, status: 'RECEIPT_SUBMITTED' },
    });

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
    };
    const reply = await this.caption(
      fa.salesAgent.receiptReceived,
      conversation,
    );
    await this.logReply(conversation, reply, uiBlock);

    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۴ گزینه A — خواندن خودکار
    // مبلغ رسید با vision؛ یک‌بار دانلود، هم برای استخراج هم برای ارسال عکس به فروشنده
    const buffer = await this.storage.downloadImage(receiptImageKey);
    const verification = await this.verifyReceiptAmount(
      buffer,
      receiptImageKey,
      order.totalAmount,
    );
    if (verification) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          receiptExtractedAmountToman: verification.extractedAmountToman,
          receiptVerifiedMatch: verification.match,
        },
      });
    }
    await this.notifySellerOfReceipt(
      conversation,
      order.id,
      receiptImageKey,
      buffer,
      verification,
    );
    return { reply, uiBlocks: [uiBlock], state: nextState };
  }

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۴ گزینه A — فقط کمک به تصمیم
  // فروشنده (تایید نهایی همچنان دست خودش است)؛ شکست استخراج (عکس بی‌کیفیت/OCR نامشخص) فلو را
  // مسدود نمی‌کند، فقط هیچ خطی به نوتیفیکیشن اضافه نمی‌شود (سکوت امن‌تر از حدس غلط)
  private async verifyReceiptAmount(
    buffer: Buffer,
    receiptImageKey: string,
    expectedAmountToman: number,
  ): Promise<{ extractedAmountToman: number; match: boolean } | null> {
    try {
      const ext = receiptImageKey.split('.').pop() ?? 'jpg';
      const dataUrl = `data:${mimeTypeForExt(ext)};base64,${buffer.toString('base64')}`;
      const visionMessage: UserModelMessage = {
        role: 'user',
        content: [
          { type: 'image', image: dataUrl },
          {
            type: 'text',
            text: 'این تصویر یک رسید انتقال وجه بانکی ایرانی (کارت‌به‌کارت/پایا/ساتنا) است. مبلغ واریزشده را به تومان استخراج کن (اگر مبلغ روی رسید به ریال نوشته شده، آن را بر ۱۰ تقسیم کن تا به تومان تبدیل شود). اگر مبلغ به‌هیچ‌وجه قابل‌تشخیص نیست، found را false بگذار و amountToman را null بگذار.',
          },
        ],
      };
      const { object } = await generateObject({
        model: this.aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(defaultModel()),
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
    } catch (err) {
      this.logger.error(
        `receipt vision extraction failed for key=${receiptImageKey}`,
        err as Error,
      );
      return null;
    }
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — عکس رسید از پشت JwtGuard+مالکیت سرو می‌شود،
  // پس سرور تلگرام نمی‌تواند خودش آن را fetch کند؛ بایت‌های واقعی multipart آپلود می‌شوند
  private async notifySellerOfReceipt(
    conversation: ConversationWithStore,
    orderId: string,
    receiptImageKey: string,
    buffer: Buffer,
    verification: { extractedAmountToman: number; match: boolean } | null,
  ): Promise<void> {
    const chatId = conversation.store.ownerTelegramChatId;
    if (!chatId) return;
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
    await this.telegramApi.sendPhotoBuffer(
      chatId,
      buffer,
      `receipt.${ext}`,
      mimeTypeForExt(ext),
      `${fa.telegram.receiptNotificationCaption}${recipientLine}${verificationLine}`,
      {
        inline_keyboard: [
          [
            {
              text: fa.telegram.receiptApproveButton,
              callback_data: `sap:${orderId}`,
            },
            {
              text: fa.telegram.receiptRejectButton,
              callback_data: `srj:${orderId}`,
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
  ): Promise<{
    source: 'STORE_KB' | 'PRODUCT_DESCRIPTION' | 'STORE_PROFILE';
    fact: string;
  } | null> {
    const match = await this.storeKb.retrieveRelevant(
      conversation.storeId,
      question,
    );
    if (match) {
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
      where: { id: { in: recentIds }, storeId: conversation.storeId },
      select: { name: true, description: true, specs: true },
    });
    const withDescription = products.filter(
      (p): p is (typeof products)[number] & { description: string } =>
        !!p.description?.trim(),
    );
    if (withDescription.length === 0) return null;

    try {
      const tone = toneForCategory(conversation.store.category);
      const model = defaultModel();
      const { object, usage } = await generateObject({
        model: this.aiProvider.buildClient()(model),
        schema: z.object({ answered: z.boolean(), reply: z.string() }),
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
      return object.answered ? object.reply.trim() : null;
    } catch (err) {
      this.logger.error(
        `tryAnswerFromProductDescriptions failed (conversation=${conversation.id})`,
        err as Error,
      );
      return null;
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
    if (!shippingInfo && !returnPolicy && !brandIntro) return null;

    const facts = [
      shippingInfo && `ارسال/هزینه‌ی ارسال: ${shippingInfo}`,
      returnPolicy && `شرایط مرجوعی/گارانتی: ${returnPolicy}`,
      brandIntro && `معرفی فروشگاه: ${brandIntro}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const tone = toneForCategory(conversation.store.category);
      const model = defaultModel();
      const { object, usage } = await generateObject({
        model: this.aiProvider.buildClient()(model),
        schema: z.object({ answered: z.boolean(), reply: z.string() }),
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
      return object.answered ? object.reply.trim() : null;
    } catch (err) {
      this.logger.error(
        `tryAnswerFromStoreProfile failed (conversation=${conversation.id})`,
        err as Error,
      );
      return null;
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

  private async transitionToHandoff(
    conversation: ConversationWithStore,
    reason:
      | 'CUSTOMER_REQUESTED'
      | 'AGENT_STUCK'
      | 'BILLING_BLOCKED'
      // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۲ — گروه‌های P1 (PAYMENT_ISSUE/
      // POST_PURCHASE_SUPPORT در buyerNeeds)؛ ربات Tool ای برای این‌ها ندارد، مستقیم ارجاع
      | 'SUPPORT_NEEDED',
  ): Promise<EngineResult> {
    const nextState: ConversationState = 'HANDOFF_HUMAN';
    await this.persistTransition(
      conversation,
      nextState,
      this.getContext(conversation),
      reason,
    );
    const reply =
      reason === 'BILLING_BLOCKED'
        ? fa.salesAgent.billingBlockedHandoff
        : reason === 'SUPPORT_NEEDED'
          ? fa.salesAgent.supportNeededHandoff
          : this.isWithinWorkingHours(conversation.store)
            ? fa.salesAgent.handoffToHuman
            : fa.salesAgent.handoffToHumanOutOfHours;
    await this.logReply(conversation, reply, { type: 'NONE' });
    await this.notifySellerOfHandoff(conversation);
    return { reply, uiBlocks: [], state: nextState };
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

  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — اگر فروشنده تلگرامش را وصل کرده باشد، سؤال
  // مشتری + دکمه‌ی «پاسخ بده» مستقیم پوش می‌شود؛ اگر نه، بی‌صدا رد می‌شود (فروشنده فقط از
  // پنل «نیاز به توجه» می‌بیند، مثل قبل)
  private async notifySellerOfHandoff(
    conversation: ConversationWithStore,
  ): Promise<void> {
    const chatId = conversation.store.ownerTelegramChatId;
    if (!chatId) return;
    const lastCustomerMessage = await this.prisma.conversationEvent.findFirst({
      where: { conversationId: conversation.id, type: 'CUSTOMER_MESSAGE' },
      orderBy: { createdAt: 'desc' },
    });
    const customerText =
      (lastCustomerMessage?.payload as { text?: string } | undefined)?.text ??
      '—';
    await this.telegramApi.sendText(
      chatId,
      fa.telegram.handoffNotification(customerText),
      {
        inline_keyboard: [
          [
            {
              text: fa.telegram.handoffReplyButton,
              callback_data: `sr:${conversation.id}`,
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
  ) {
    const fromState = conversation.currentState;
    await this.prisma.$transaction([
      ...(toolName
        ? [
            this.prisma.conversationEvent.create({
              data: {
                conversationId: conversation.id,
                type: 'TOOL_CALL',
                payload: { toolName },
              },
            }),
          ]
        : []),
      this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'STATE_TRANSITION',
          payload: { fromState, toState: nextState },
        },
      }),
      this.prisma.salesConversation.update({
        where: { id: conversation.id },
        data: {
          currentState: nextState,
          contextData: context,
          isMutedForHuman: nextState === 'HANDOFF_HUMAN' ? true : undefined,
        },
      }),
    ]);
    conversation.currentState = nextState;
    // بخش ۱.۴ docs/PRD-full-agent-engineering-review.md — قبلاً فقط ردیف DB آپدیت می‌شد، نه
    // آبجکت درون‌حافظه‌ای؛ چون runFullAgentTurn همین آبجکت conversation را بین تلاش اول و
    // fallback پاس می‌دهد (بدون fetch دوباره)، بدون این خط هر retry از وضعیت قبل از جهش
    // (نه چیزی که واقعاً در DB نشسته) ادامه می‌داد
    conversation.contextData = context;
  }

  private async logReply(
    conversation: ConversationWithStore,
    text: string,
    uiBlock: UiBlock,
    flag?: 'UNCLEAR' | 'NO_KB_MATCH',
    trace?: AiTraceData,
  ) {
    // برخلاف قبل، طول کوتاه/رسیدن به سقف باید از هم تفکیک شوند (نه فقط یک بولین) — بخش
    // voice.reason در AI_TRACE (docs/PRD-admin-ai-decision-trace-log.md بخش ۱) به همین نیاز دارد
    let wantsVoice = false;
    let voiceReason:
      | 'TOO_SHORT'
      | 'CONVERSATION_CAP'
      | 'VOICE_VARIANT_OFF'
      | 'CONSECUTIVE_CAP'
      | 'STORE_NO_CREDIT_CAP'
      | undefined;
    if (text.length > VOICE_MIN_REPLY_CHARS) {
      // docs/PRD-sales-agent-voice.md بخش ۶.۱ — گروه OFF باید واقعاً هیچ وویسی نبیند، نه
      // فقط اینکه پخش نشود؛ پس قبل از reserveVoiceSlot چک می‌شود (سهمیه‌ی مکالمه هم دست‌نخورده می‌ماند)
      if (conversation.voiceVariant === 'OFF') {
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
    const payload: Prisma.InputJsonObject = {
      text,
      uiBlock,
      ...(flag ? { flag } : {}),
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

    let traceEventId: string | undefined;
    if (trace) {
      const tracePayload: Prisma.InputJsonObject = {
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
