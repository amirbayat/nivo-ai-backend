import type { ProductVideoItem } from '../store/product-video.types';

// docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۲ — فقط زیرمجموعه‌ای که گام ۱ واقعاً می‌سازد
// (بدون ProductVariant/CART_SUMMARY چندمتغیره؛ طبق ساده‌سازی پلن گام ۱)
export type CartItem = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
};

export type ConversationContext = {
  cart: CartItem[];
  // آخرین لیست محصولاتی که با PRODUCT_CARD نشان داده شده — برای ارجاع‌های ترتیبی مشتری
  // («اولی رو بذار تو سبد») بدون اینکه مدل مستقیم productId حدس بزند
  lastShownProducts?: { id: string; name: string }[];
  // docs/PRD-customer-comments-and-discounts.md بخش ۹ — کد تخفیفی که همین الان روی سبد
  // اعمال شده؛ فقط در doCreateOrder مصرف می‌شود (atomic increment)، اینجا صرفاً پیش‌نمایش است
  appliedDiscount?: { id: string; code: string; amountToman: number } | null;
  // docs/PRD-product-display-focus-and-variations.md §۲ — وقتی مکالمه از یک لینک اختصاصی
  // محصول (وب یا تلگرام) شروع شده، showProduct همین‌جا ثبت می‌کند؛ تا وقتی ست است،
  // handleMessage پیام‌های BROWSE عمومی را به‌جای جستجوی چندمحصولی دوباره روی همین محصول
  // متمرکز می‌کند. کاملاً گذرا/کنترلی است، جایی گزارش‌دهی نمی‌شود — به همین دلیل اینجا
  // (JSON context) است، نه ستون دیتابیس
  anchoredProductId?: string | null;
  // همان بخش — شمارنده‌ی پیام‌های متوالی با نشانه‌ی تردید/نارضایتی حین anchor بودن؛ با
  // ADD_TO_CART صفر می‌شود، با رسیدن به ۲ انکر برداشته می‌شود (مشتری محصول جایگزین می‌بیند)
  anchorHesitationStreak?: number;
  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ — گام فعلی فلوی
  // ADDRESS_COLLECTION (conversation-engine.service.ts's handleAddressInput/handleAction)؛
  // نبودش یعنی هنوز وارد این فلو نشده‌ایم
  addressStep?:
    | 'choose'
    | 'name'
    | 'phone'
    | 'province'
    | 'address'
    | 'postal'
    | 'confirm'
    | 'saveDecision';
  // docs/PRD-buyer-saved-addresses.md — آدرس در حال جمع‌آوری/تایید، هنوز روی Order ننشسته
  pendingAddress?: {
    recipientName?: string;
    recipientPhone?: string;
    province?: string;
    address?: string;
    postalCode?: string | null;
    // اگر از یک CustomerAddress ذخیره‌شده انتخاب شده (نه تازه‌نویس)، شناسه‌اش اینجا می‌ماند
    // تا بعد از تایید فقط lastUsedAt‌اش آپدیت شود، نه این‌که دوباره «ذخیره کنم؟» پرسیده شود
    fromSavedAddressId?: string | null;
  } | null;
};

export type UiBlock =
  | {
      type: 'PRODUCT_CARD';
      products: {
        id: string;
        name: string;
        basePrice: number;
        stock: number;
        images: string[];
        // docs/PRD-product-video.md بخش ۴ — چندویدیویی، فرانت با MediaCarousel ویدیو(ها)
        // را قبل از عکس‌ها نشان می‌دهد
        videos: ProductVideoItem[];
      }[];
    }
  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۳ — برخلاف PRODUCT_CARD که فقط
  // images[0] را می‌فرستد، این بلاک همه‌ی عکس‌های محصول را حمل می‌کند، برای وقتی مشتری
  // صریحاً عکس بیشتر خواسته (BuyerNeedTag.REQUEST_MORE_PHOTOS). docs/PRD-product-video.md
  // بخش ۴ — videos هم اضافه شد تا MediaCarousel اینجا هم ویدیو(ها)+عکس‌ها را یکجا نشان دهد
  | {
      type: 'PRODUCT_PHOTOS';
      productId: string;
      productName: string;
      images: string[];
      videos: ProductVideoItem[];
    }
  | { type: 'CART_SUMMARY'; items: CartItem[]; total: number }
  | {
      type: 'PAYMENT_INSTRUCTIONS';
      cardNumber: string;
      ownerName: string;
      amount: number;
    }
  | { type: 'ORDER_STATUS'; orderId: string; status: string }
  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ + docs/PRD-buyer-saved-addresses.md —
  // یک نوع بلاک با سه حالت (نه سه نوع جدا) تا سطح UiBlock شلوغ نشود؛ هر حالت فقط فیلدهای
  // مرتبط با خودش را پر می‌کند
  | {
      type: 'ADDRESS_PROMPT';
      mode: 'CHOOSE_SAVED' | 'CHOOSE_PROVINCE' | 'CONFIRM' | 'ASK_SAVE';
      addresses?: { id: string; summary: string }[]; // فقط CHOOSE_SAVED
      // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — فقط CHOOSE_PROVINCE
      provinces?: string[];
      summary?: string; // فقط CONFIRM
      shippingCostToman?: number; // فقط CONFIRM
      provinceCovered?: boolean; // فقط CONFIRM — false یعنی فروشنده به این استان ارسال ندارد
    }
  | { type: 'NONE' };

// docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۳ — لایه‌ی «نیاز خریدار»، مکمل و جدا از
// intent اجرایی بالا (چندبرچسبی؛ یک پیام هم می‌تواند هم قیمت هم سایز بخواهد). PAYMENT_ISSUE و
// POST_PURCHASE_SUPPORT گروه‌های P1 هستند — فقط شناسایی+ارجاع به فروشنده (بخش ۲ همان سند)،
// نه یک handler اختصاصی
export type BuyerNeedTag =
  // گروه A — اطلاعاتی/پیش از خرید
  | 'PRODUCT_SPEC'
  | 'USAGE_GUIDE'
  | 'STOCK_CHECK'
  | 'VARIANT_REQUEST'
  | 'PRODUCT_COMPARISON'
  | 'PRODUCT_RECOMMENDATION'
  | 'ASK_REVIEWS'
  | 'ASK_AUTHENTICITY'
  | 'ASK_SHIPPING'
  | 'ASK_PAYMENT_METHODS'
  | 'ASK_WARRANTY_RETURN_POLICY'
  | 'ASK_STORE_TRUST'
  | 'ASK_COMPATIBILITY'
  | 'ASK_NAVIGATION_HELP'
  | 'ASK_RESTOCK_ETA'
  | 'ASK_CASH_ON_DELIVERY'
  | 'PURCHASE_HESITATION'
  // گروه B — قیمت و تخفیف (APPLY_DISCOUNT خودش یک intent اجرایی مجزاست، اینجا تکرار نمی‌شود)
  | 'ASK_PRICE'
  | 'REQUEST_DISCOUNT'
  | 'NEGOTIATE_PRICE'
  | 'ASK_BULK_PURCHASE'
  | 'ASK_INSTALLMENT'
  // گروه C — رسانه
  | 'REQUEST_MORE_PHOTOS'
  | 'REQUEST_VIDEO'
  | 'IMAGE_SEARCH_REQUEST'
  // گروه D — عملیات سفارش پیش از تکمیل
  | 'CUSTOM_ORDER_REQUEST'
  | 'GIFT_WRAP_REQUEST'
  | 'RESTOCK_NOTIFY_REQUEST'
  | 'REQUEST_INVOICE'
  | 'RESERVATION_PREORDER_REQUEST'
  // گروه G — متا/کنترل مکالمه
  | 'BOT_FRUSTRATION'
  | 'POSITIVE_FEEDBACK'
  | 'OFF_TOPIC_OR_SPAM'
  | 'TALK_TO_SELLER'
  // P1 — فقط شناسایی + ارجاع به فروشنده (گروه‌های E/F سند)
  | 'PAYMENT_ISSUE'
  | 'POST_PURCHASE_SUPPORT';

// خروجی generateObject روی پیام خام مشتری — فقط NLU، هیچ تصمیم DB/state اینجا گرفته نمی‌شود
export type ParsedIntent = {
  intent:
    | 'BROWSE'
    | 'ADD_TO_CART'
    | 'REMOVE_FROM_CART'
    | 'VIEW_CART'
    | 'CHECKOUT'
    | 'ASK_FAQ'
    | 'CONFIRM'
    | 'CANCEL'
    | 'REQUEST_HUMAN'
    | 'APPLY_DISCOUNT'
    | 'UNCLEAR';
  // فقط وقتی از خود مدل واقعاً خواسته شده (callParseIntent) پر می‌شود؛ در fallback نهایی
  // ({intent:'UNCLEAR'} بعد از شکست دوباره‌ی AI) خالی می‌ماند — به همین دلیل اختیاری است
  intentConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  productQuery?: string | null;
  // ارجاع ترتیبی به آخرین لیست نشان‌داده‌شده («اولی»/«دومی») — ۱-پایه؛ اگر ست باشد، بر
  // productQuery اولویت دارد (resolveProductRef در conversation-engine.service.ts)
  productIndex?: number | null;
  quantity?: number | null;
  // docs/PRD-customer-comments-and-discounts.md بخش ۹ — فقط وقتی intent=APPLY_DISCOUNT
  discountCode?: string | null;
  // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۴.۲ — لایه‌ی آنالیتیکس، تک فراخوانی با
  // enum اجرایی بالا (نه یک classification جدا)
  buyerNeeds?: BuyerNeedTag[] | null;
  // وقتی پیام واضح یک نیاز دارد ولی با هیچ‌کدام از BuyerNeedTag جور نیست — برچسب آزاد مدل،
  // برای فیچر کشف intent های کاور نشده (همان سند، بخش ۵)
  unmatchedBuyerNeed?: string | null;
  // docs/PRD-sales-agent-implicit-need-detection.md بخش ۴.۱ — سه سیگنال مستقل، جدا از intent/
  // buyerNeeds بالا. فقط وقتی از خود مدل واقعاً خواسته شده پر می‌شوند؛ در fallback نهایی
  // ({intent:'UNCLEAR'}) خالی می‌مانند — دقیقاً مثل intentConfidence، به همین دلیل اختیاری‌اند
  needType?: 'EXPLICIT' | 'IMPLICIT' | 'NONE';
  implicitNeedSummary?: string | null;
  storeRelevance?: 'RELEVANT' | 'POSSIBLY_RELEVANT' | 'NOT_RELEVANT';
  pitchReadiness?: 'READY' | 'NEEDS_CLARIFICATION' | 'NOT_READY';
};

export type EngineResult = {
  reply: string;
  uiBlocks: UiBlock[];
  state: string;
};

// دکمه‌های UiBlock (افزودن به سبد/تایید سبد) دیگر جمله‌ی فارسی نمی‌سازند تا از مسیر
// parseIntent رد شوند — productId از خودِ دکمه معلوم است، نیازی به حدس مدل نیست
// (فیدبک اول پایلوت: کلیک روی دکمه گاهی «نامفهوم» تشخیص داده می‌شد)
// شکل مسطح، عیناً مثل SalesActionDto (نه یک union تفکیک‌شده‌ی سخت‌گیر) — چون همان instance
// اعتبارسنجی‌شده‌ی DTO مستقیم به engine پاس می‌شود؛ productId فقط برای ADD_TO_CART لازم
// است، engine.handleAction خودش نبودش را چک می‌کند
// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ — دکمه‌های فلوی ADDRESS_COLLECTION
// (دقیقاً همان قرارداد بالا: شکل مسطح، نه union سخت‌گیر؛ addressId فقط برای SELECT_ADDRESS لازم است)
export type SalesAction = {
  type:
    | 'ADD_TO_CART'
    | 'CONFIRM_CART'
    | 'SELECT_ADDRESS'
    | 'NEW_ADDRESS'
    | 'SELECT_PROVINCE'
    | 'CONFIRM_ADDRESS'
    | 'EDIT_ADDRESS'
    | 'SAVE_ADDRESS'
    | 'SKIP_SAVE_ADDRESS';
  productId?: string;
  qty?: number;
  addressId?: string;
  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — فقط برای SELECT_PROVINCE
  province?: string;
};

// docs/PRD-sales-agent-voice.md بخش ۱ — payload صف sales-agent-voice؛ در conversation-engine
// (producer, logReply) و sales-agent-voice.processor.ts (consumer) هر دو استفاده می‌شود
export type SalesAgentVoiceJobData = {
  eventId: string;
  conversationId: string;
  text: string;
  storeCategory: string | null;
  // docs/PRD-admin-ai-decision-trace-log.md بخش ۲ — اگر این پاسخ trace داشت، پردازشگر وویس
  // بعداً بخش voice همان ConversationEvent(AI_TRACE) را هم آپدیت می‌کند
  traceEventId?: string;
};

// docs/PRD-sales-agent-persuasion-principles.md بخش ۸ — خودِ مدل در respond_to_customer این را
// خوداظهاری می‌کند (هیچ راه برنامه‌نویسی‌شده‌ای برای تشخیص «کدام اصل در متن استفاده شد» نیست)
export type PersuasionTechnique =
  | 'COMMITMENT_CONSISTENCY'
  | 'SOCIAL_PROOF'
  | 'AUTHORITY'
  | 'LIKING'
  | 'RECIPROCITY'
  | 'SCARCITY';

// docs/PRD-admin-ai-decision-trace-log.md بخش ۱ — محتوای ConversationEvent(AI_TRACE)، همراه
// هر AGENT_REPLY که واقعاً از یک تصمیم/فراخوان AI آمده باشد (نه پاسخ‌های قانون‌محور ثابت)
export type AiTraceData = {
  intent: string;
  handler: string;
  factsOrPrompt: string;
  model: string;
  kbSource?: 'STORE_KB' | 'PRODUCT_DESCRIPTION' | 'STORE_PROFILE' | 'STUB';
  // docs/PRD-buyer-purchase-intent-taxonomy.md — فقط روی trace سطح parseIntent پر می‌شود
  // (handler: 'parseIntent')، نه روی trace های اختصاصی هر handler
  buyerNeeds?: BuyerNeedTag[];
  unmatchedBuyerNeed?: string;
  intentConfidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  // docs/PRD-sales-agent-persuasion-principles.md بخش ۸ — فقط روی trace سطح runFullAgentTurn
  // پر می‌شود (handler: 'runFullAgentTurn')؛ خالی/نبودن یعنی هیچ تکنیکی استفاده نشد
  persuasionTechniquesUsed?: PersuasionTechnique[];
  usedGeneralKnowledge?: boolean;
  // docs/PRD-full-agent-engineering-review.md بخش ۵ — فقط روی trace سطح runFullAgentTurn پر
  // می‌شوند؛ همه‌شان همین الان، رایگان، در حافظه‌ی callFullAgentTurn موجودند (local variable)،
  // فقط باید serialize شوند — هدف: پیداکردن باگ «کارت/پاسخ اشتباه» در یک نگاه، بدون نیاز به
  // حدس‌زدن یا reproduce دستی
  relevantProductIdsRaw?: string[];
  lastShownProducts?: { id: string; name: string }[];
  toolsCalled?: { name: string; args: unknown }[];
  initialCatalogProductIds?: string[];
  stepsUsed?: number;
  mutationHappened?: boolean;
  progressHappened?: boolean;
  isFallbackAttempt?: boolean;
  // docs/PRD-full-agent-engineering-review.md بخش ۴/۱۱ — اعداد+«تومان» در متن نهایی که با هیچ
  // قیمت/مبلغ واقعی این نوبت مطابقت نداشتند؛ فقط لاگ است، هرگز رفتار/پاسخ را عوض نمی‌کند
  suspiciousPriceClaims?: number[];
};
