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
    | 'UNCLEAR';
  productQuery?: string;
  // ارجاع ترتیبی به آخرین لیست نشان‌داده‌شده («اولی»/«دومی») — ۱-پایه؛ اگر ست باشد، بر
  // productQuery اولویت دارد (resolveProductRef در conversation-engine.service.ts)
  productIndex?: number;
  quantity?: number;
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
