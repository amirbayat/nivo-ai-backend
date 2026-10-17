import type { LastSearch } from './product-finder/finder-output';
import type { SalesMemory } from './sales-machine/sales-machine.types';
import type { ProductVideoItem } from '../store/product-video.types';
import type { ProductSpecItem } from '../store/product-specs.types';
import type { OrderPaymentMethod } from '@prisma/client';

// docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۲ — گام ۱. docs/PRD-product-display-focus-and-variations.md
// §۴ (فاز ۱) — variantId/variantLabel اختیاری‌اند: محصول بدون واریانت (اکثریت) این دو را
// نمی‌سازد؛ variantLabel همین‌جا (نه با join موقع نمایش سبد/سفارش قدیمی) ذخیره می‌شود چون
// Order.items یک عکس فوری (snapshot) است، نه رفرنس زنده به ProductVariant
export type CartItem = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  variantId?: string;
  variantLabel?: string;
};

// همان سند §۴.۲ — در حین انتخاب واریانت، بین دو/چند دکمه‌ای که پشت‌سرهم پرسیده می‌شوند
// (مثلاً اول «سایز» بعد «رنگ») این وضعیت را نگه می‌دارد. مرحله‌ی فعلی از روی طول
// selectedValues نسبت‌به ProductOptionType های محصول محاسبه می‌شود، نه یک فیلد جدا.
// mode=ALTERNATIVES یعنی همه‌ی ابعاد انتخاب شدند ولی آن ترکیب دقیق موجودی نداشت — چیپ‌ها
// دیگر مقدار یک بعد نیستند، مستقیم شناسه‌ی یک ProductVariant موجود هستند (resolveVariantSelectionValue)
export type PendingVariantSelection = {
  productId: string;
  qty: number;
  selectedValues: Record<string, string>;
  mode: 'DIMENSION' | 'ALTERNATIVES';
};

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱/۲ — snapshot آدرس+هزینه‌ی ارسال
// که روی Order می‌نشیند (executeCreateOrder/finalizeOrder در conversation-engine.service.ts
// مصرفش می‌کنند). این‌جا export می‌شود (نه محلی در آن فایل) چون
// ConversationContext.pendingOrderAddressSnapshot پایین هم به همین شکل نیاز دارد
export type AddressSnapshot = {
  recipientName: string;
  recipientPhone: string;
  province: string;
  address: string;
  postalCode: string | null;
  addressId: string | null;
  shippingCostToman: number;
};

// فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — خودگزارش‌دهی مدل از وضعیت «انسانی/فروش» مشتری، بعد از هر نوبت —
// برای هر دو نوع فروشگاه (leadCaptureOnly و کاتالوگ واقعی)، برخلاف LeadFunnelStage که فقط
// مخصوص leadCaptureOnly بود. دقیقاً همان الگوی leadFunnelStage: خودِ مدل همین را در همان
// respond_to_customer گزارش می‌دهد (بدون کال جدای LLM)، و نوبت بعد به‌عنوان «آخرین تحلیل» در
// پرامپت و چند دستورالعمل استراتژی (conversation-engine.service.ts) مصرف می‌شود
export type CustomerState = {
  pain: string | null;
  painSolvable: 'UNKNOWN' | 'YES' | 'PARTIAL' | 'NO';
  empathyShown: boolean;
  attentionCaptured: boolean;
  stage:
    | 'DISCOVERY'
    | 'PAIN_IDENTIFIED'
    | 'PITCHED'
    | 'OBJECTION'
    | 'READY'
    | 'STALLED'
    | 'LOST';
};

export type ConversationContext = {
  cart: CartItem[];
  // همان توضیح بالا — آخرین خودگزارشی‌ای که مدل درباره‌ی وضعیت مشتری داده؛ نبودنش یعنی هنوز
  // هیچ نوبتی از این مکالمه این را گزارش نداده (مکالمه‌های قدیمی‌تر از این فیچر)
  customerState?: CustomerState | null;
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
    | 'form'
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
  // docs/PRD-product-display-focus-and-variations.md §۴.۲ — وقتی ست است، handleMessage پیام
  // آزاد را به‌جای parseIntent مستقیم به handleVariantSelectionInput می‌دهد (عیناً الگوی
  // addressStep بالا)؛ با افزودن موفق به سبد یا لغو، null می‌شود
  pendingVariantSelection?: PendingVariantSelection | null;
  // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — وقتی فروشگاه هم کارت‌به‌کارت هم
  // لینک اسنپ‌پی فعال دارد، قبل از ساخت واقعی Order از خریدار می‌پرسیم کدام را می‌خواهد؛ این
  // snapshot (اگر فروشگاه ارسال داشت) تا جواب برسد همین‌جا نگه داشته می‌شود — عیناً الگوی
  // pendingAddress بالا. null یعنی هیچ آدرسی در کار نبوده (فروش حضوری/دیجیتال)
  pendingOrderAddressSnapshot?: AddressSnapshot | null;
  // docs/PRD-sales-agent-sales-state-machine.md §۵ — حافظه‌ی ماشین‌حالت فروش؛ نبودنش یعنی
  // مکالمه قبل از این فیچر شروع شده (loadSalesMemory آن را از customerState/lastShownProducts می‌سازد)
  sales?: SalesMemory | null;
  // docs/DESIGN-structured-product-search-for-chat-agent.md §۶.۳ — آخرین search_products ساختاریافته؛
  // برای ارجاع‌هایی مثل «پایین‌تر ندارید؟» در نوبت بعد (بدون migration، داخل contextData)
  lastSearch?: LastSearch | null;
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
        // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۸.۱ — فقط محصولات
        // WEIGHT_BASED_FORMULA این‌ها را پر دارند؛ goldPricingSummary یک خط فارسیِ آماده‌ی
        // «وزن/عیار/اجرت/سود/مالیات» است، یک‌بار فرمت‌شده در بک‌اند
        weightGrams?: number | null;
        purityKarat?: number | null;
        isWeightBasedPricing?: boolean;
        goldPricingSummary?: string | null;
        // docs/PRD-buyer-chat-redesign.md B2 — فرانت با این می‌فهمد «افزودن» باید شیت محصول را باز کند؛
        // در logReply پر می‌شود (کلاینت‌های قدیمی نادیده می‌گیرند)
        hasVariants?: boolean;
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
      // 3.8 — کد سفارش (با خط تیره‌ی نمایشی) و مهلت پرداخت (ISO)؛ اختیاری چون مسیرهای
      // قدیمی‌تر تولید بلاک (salvage) سفارش را در دست ندارند
      orderCode?: string;
      dueAt?: string;
    }
  // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — بلاک جدا از PAYMENT_INSTRUCTIONS
  // بالا (نه یک mode روی همان)، چون رندر کاملاً فرق دارد (لینک قابل‌کلیک، نه شماره‌کارت) و
  // مصرف‌کننده‌های فعلی PAYMENT_INSTRUCTIONS نباید نگران فیلدهای جدید باشند
  | {
      type: 'SNAPPPAY_PAYMENT_INSTRUCTIONS';
      link: string;
      amount: number;
      orderCode?: string;
      dueAt?: string;
    }
  // همان سند — فقط وقتی فروشگاه هم کارت‌به‌کارت هم لینک اسنپ‌پی فعال دارد نشان داده می‌شود؛
  // options همیشه هر دو مقدار را دارد (این بلاک اصلاً ساخته نمی‌شود مگر هر دو فعال باشند)
  | { type: 'PAYMENT_METHOD_PROMPT'; options: OrderPaymentMethod[] }
  | { type: 'ORDER_STATUS'; orderId: string; status: string; orderCode?: string }
  | {
      type: 'REFUND_DESTINATION_FORM';
      refundId: string;
      orderId: string;
      amountToman: number;
      deadlineHours: number;
      status: 'OPEN' | 'SAVED' | 'PAID';
      destinationMasked?: string;
    }
  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ + docs/PRD-buyer-saved-addresses.md —
  // یک نوع بلاک با سه حالت (نه سه نوع جدا) تا سطح UiBlock شلوغ نشود؛ هر حالت فقط فیلدهای
  // مرتبط با خودش را پر می‌کند
  | {
      type: 'ADDRESS_PROMPT';
      mode: 'CHOOSE_SAVED' | 'CHOOSE_PROVINCE' | 'CONFIRM' | 'ASK_SAVE' | 'FORM';
      addresses?: { id: string; summary: string }[]; // فقط CHOOSE_SAVED
      // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — فقط CHOOSE_PROVINCE
      provinces?: string[];
      prefillName?: string;
      prefillPhone?: string;
      fieldErrors?: Partial<
        Record<'name' | 'phone' | 'province' | 'city' | 'street' | 'postal', string>
      >;
      values?: {
        recipientName: string;
        recipientPhone: string;
        province: string;
        city: string;
        addressText: string;
        postalCode: string;
        plaque: string;
        unit: string;
      };
      summary?: string; // فقط CONFIRM
      shippingCostToman?: number; // فقط CONFIRM
      provinceCovered?: boolean; // فقط CONFIRM — false یعنی فروشنده به این استان ارسال ندارد
    }
  // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۶ (فاز ۴.۸) — سفارش مجدد با یک دکمه؛
  // سفارش‌های همین Customer (نه فقط همین مکالمه)، تازه‌ترین اول
  | {
      type: 'ORDER_LIST';
      orders: {
        id: string;
        createdAt: string;
        items: CartItem[];
        totalAmount: number;
        status: string;
        orderCode?: string;
      }[];
    }
  // همان بخش — مقایسه‌ی ۲-۳ محصول کنار هم؛ specs از همان فیلد Product.specs (فاز ۴.۳)
  | {
      type: 'COMPARE_CARD';
      products: {
        id: string;
        name: string;
        basePrice: number;
        stock: number;
        specs: ProductSpecItem[];
      }[];
    }
  // docs/PRD-product-display-focus-and-variations.md §۴.۲ — چیپ‌های انتخاب سریع واریانت؛
  // mode=DIMENSION یعنی values مقادیر یک ProductOptionType هستند (مثلاً سایزها)، mode=ALTERNATIVES
  // یعنی ترکیب انتخابی تمام شده و values معادل‌های موجود هستند — هر دو با همان SalesAction
  // (SELECT_VARIANT_VALUE) جواب داده می‌شوند، فرق را فقط سرور از روی ctx می‌داند
  | {
      type: 'VARIANT_PROMPT';
      productId: string;
      productName: string;
      optionName: string | null; // فقط mode=DIMENSION
      values: { label: string; value: string }[];
      selectedSoFar: Record<string, string>;
      mode: 'DIMENSION' | 'ALTERNATIVES';
    }
  // فیدبک کاربر ۱۴۰۵/۰۷/۲۰ — برای فروشگاه‌های leadCaptureOnly؛ بعد از ثبت لید، اگر فروشگاه
  // websiteUrl داشته باشد، یک دکمه‌ی «مشاهده وبسایت» که در تب جدید باز می‌شود نشان داده شود
  | { type: 'VISIT_WEBSITE'; url: string }
  // docs/PRD-nivo-lead-shop-seller-signup.md §5.2 — کارت ثبت‌نام داخل چت (فقط فروشگاه لید)
  | { type: 'SIGNUP_CARD'; prefillPhone?: string }
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
  // docs/PRD-sales-agent-sales-state-machine.md §۱۲.۱ — دکمه‌های پاسخ سریع زیر پیام (فقط مسیر
  // ماشین‌حالت فروش آن را پر می‌کند)
  quickReplies?: string[];
  // 0.13b — اگر اکشن روی یک مکالمه‌ی دارای سفارش آمد، مکالمه‌ی تازه‌ای ساخته شده؛ کلاینت وب
  // باید به این شناسه سوییچ کند
  switchedConversationId?: string;
  // 0.4 — پیام در صف رفت چون مکالمه در حال پردازش یک turn دیگر است (جوابش بعداً از polling می‌آید)
  queued?: boolean;
  // 0.4 — قفل اکشن در بازه‌ی انتظار آزاد نشد (کاربر چند لحظه بعد دوباره امتحان کند)
  busy?: boolean;
  // 4.15 — POST returns immediately; tokens arrive on the turn event stream
  turnId?: string;
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
    | 'SET_CART_QTY'
    | 'REMOVE_CART_ITEM'
    | 'CONFIRM_CART'
    | 'SELECT_ADDRESS'
    | 'NEW_ADDRESS'
    | 'SUBMIT_ADDRESS'
    | 'SELECT_PROVINCE'
    | 'CONFIRM_ADDRESS'
    | 'EDIT_ADDRESS'
    | 'SAVE_ADDRESS'
    | 'SKIP_SAVE_ADDRESS'
    // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۶ (فاز ۴.۸)
    | 'VIEW_ORDERS'
    | 'TOGGLE_SAVE_PRODUCT'
    | 'REORDER'
    // docs/PRD-product-display-focus-and-variations.md §۴.۲ — جواب چیپ VARIANT_PROMPT؛ فقط
    // وقتی ctx.pendingVariantSelection واقعاً موجود است معنا دارد (handleAction چک می‌کند)
    | 'SELECT_VARIANT_VALUE'
    // docs/PRD-buyer-payment-method-card-or-snapppay-link.md — جواب دکمه‌ی PAYMENT_METHOD_PROMPT؛
    // فقط وقتی conversation.currentState واقعاً PAYMENT_METHOD_SELECTION است معنا دارد
    | 'SELECT_PAYMENT_METHOD'
    // 0.11a — نمایش کارت یک محصول (لینک اختصاصی محصول برای خریدار برگشتی)، بدون LLM
    | 'FOCUS_PRODUCT';
  productId?: string; // ADD_TO_CART, TOGGLE_SAVE_PRODUCT, FOCUS_PRODUCT, SET_CART_QTY, REMOVE_CART_ITEM
  qty?: number;
  variantId?: string;
  addressId?: string;
  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — فقط برای SELECT_PROVINCE
  province?: string;
  recipientName?: string;
  recipientPhone?: string;
  addressText?: string;
  city?: string;
  postalCode?: string;
  plaque?: string;
  unit?: string;
  orderId?: string; // فقط REORDER
  // فقط SELECT_VARIANT_VALUE — در mode=DIMENSION یک ProductOptionValue.value، در mode=ALTERNATIVES
  // یک ProductVariant.id
  value?: string;
  paymentMethod?: OrderPaymentMethod; // فقط SELECT_PAYMENT_METHOD
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
  // ACE-8 — موتور نوبتی که این وویس را خواست؛ کش وویس فقط برای 'lean'
  engine?: 'stable' | 'lean';
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
  // فیدبک کاربر ۱۴۰۵/۰۷/۲۰ — فقط فروشگاه‌های leadCaptureOnly، خوداظهاری مدل هر نوبت (نگاه کن
  // به enum LeadFunnelStage در schema.prisma)
  leadFunnelStage?: string;
  // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ — هر دو نوع فروشگاه، خوداظهاری مدل هر نوبت؛ نگاه کن به CustomerState بالا
  customerState?: CustomerState;
  // فیدبک کاربر ۱۴۰۵/۰۸/۲۱ («دیگه رد خور نداشته باشه») — گارد قطعی روی تناقض خودگزارشی
  // customerState؛ نگاه کن به conversation-engine.service.ts، درست بعد از finalCall اول در
  // callFullAgentTurn. وجودش یعنی تناقض تشخیص داده شد؛ نبودنش یعنی هیچ تناقضی نبود
  correctiveRetryReason?:
    'READY_WITHOUT_ACTION' | 'PAIN_NOT_SOLVABLE_CONTRADICTION';
  // docs/PRD-sales-agent-sales-state-machine.md §۱۶ — فقط مسیر ماشین‌حالت فروش (handler: 'callSalesTurn')
  salesStage?: string;
  prevSalesStage?: string;
  turnGoal?: string;
  decisionReason?: string;
  perception?: unknown;
  perceptionFailed?: boolean;
  validatorViolations?: unknown[];
  correctiveRetry?: boolean;
  candidateProductIds?: string[];
  quickReplies?: string[];
};
