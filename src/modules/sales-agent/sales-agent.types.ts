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
      }[];
    }
  | { type: 'CART_SUMMARY'; items: CartItem[]; total: number }
  | {
      type: 'PAYMENT_INSTRUCTIONS';
      cardNumber: string;
      ownerName: string;
      amount: number;
    }
  | { type: 'ORDER_STATUS'; orderId: string; status: string }
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
export type SalesAction = {
  type: 'ADD_TO_CART' | 'CONFIRM_CART';
  productId?: string;
  qty?: number;
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
};
