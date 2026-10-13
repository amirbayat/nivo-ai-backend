// docs/PRD-sales-agent-sales-state-machine.md §۵ — تایپ‌های ماشین‌حالت فروش. این فایل (و بقیه‌ی
// sales-machine/*) عمداً خالص است: هیچ Prisma/Nest/AI SDK ای import نمی‌کند (به‌جز تایپ‌ها و zod)
// تا unit test بدون DB/شبکه اجرا شود
import type { ConversationState } from '@prisma/client';

// §۵.۱ — مرحله‌ی فروش (ستون DB SalesConversation.salesStage + حافظه)
export const SALES_STAGES = [
  'OPENING',
  'DISCOVERY',
  'RECOMMENDATION',
  'EVALUATION',
  'OBJECTION',
  'CLOSING',
  'CHECKOUT',
  'POST_PURCHASE',
  'NOT_A_FIT',
  'DORMANT',
] as const;
export type SalesStage = (typeof SALES_STAGES)[number];

// §۵.۲ — هدف همین نوبت
export const TURN_GOALS = [
  'GREET_AND_OPEN',
  'DISCOVER_NEED',
  'RECOMMEND',
  'ANSWER_AND_ADVANCE',
  'HANDLE_OBJECTION',
  'TRIAL_CLOSE',
  'ALTERNATIVE_CLOSE',
  'EXECUTE_PURCHASE',
  'ASSIST_CHECKOUT',
  'POST_PURCHASE_CARE',
  'HONEST_NOT_A_FIT',
  'SOFT_EXIT',
] as const;
export type TurnGoal = (typeof TURN_GOALS)[number];

export const OBJECTION_TYPES = [
  'PRICE',
  'TRUST',
  'QUALITY',
  'FIT',
  'TIMING',
  'SHIPPING',
  'PAYMENT',
  'COMPETITOR',
  'NEED_APPROVAL',
  'OTHER',
] as const;
export type ObjectionType = (typeof OBJECTION_TYPES)[number];

export type ObjectionRecord = {
  type: ObjectionType;
  quote: string; // جمله‌ی خود مشتری، حداکثر ۱۲۰ کاراکتر
  attempts: number; // چند بار این نوع را مدیریت کردیم
  status: 'OPEN' | 'ADDRESSED' | 'RESOLVED' | 'UNRESOLVED';
  lastTurn: number;
};

export type ProductInterest = {
  id: string;
  name: string;
  priceToman: number; // ۰ = نامعلوم (مهاجرت از مکالمه‌ی قدیمی) — هرگز ۰ در پرامپت چاپ نشود
  signal: 'SHOWN' | 'ASKED' | 'COMPARED' | 'IN_CART' | 'REJECTED';
  note: string | null;
  lastTurn: number;
};

export type SalesSlots = {
  customerName: string | null;
  goal: string | null;
  recipient: string | null;
  budgetMaxToman: number | null;
  budgetMinToman: number | null;
  size: string | null;
  color: string | null;
  preferences: string[]; // حداکثر ۶
  dealBreakers: string[]; // حداکثر ۴
  deadline: string | null;
  experienceLevel: string | null;
  quantity: number | null;
  province: string | null;
};

export type Sentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'FRUSTRATED';

export type SalesMemory = {
  version: 1;
  stage: SalesStage;
  stageEnteredTurn: number;
  turn: number; // شماره‌ی نوبت مشتری در این مکالمه، از ۱
  lastGoal: TurnGoal | null;
  slots: SalesSlots;
  needSummary: string | null;
  objections: ObjectionRecord[]; // حداکثر ۶، جدیدترین آخر
  interests: ProductInterest[]; // حداکثر ۸، جدیدترین آخر
  askedQuestions: { text: string; turn: number }[]; // حداکثر ۸
  discoveryQuestionsAsked: number;
  lastAgentQuestion: string | null;
  lastCloseOffer: {
    productIds: string[];
    options: string[];
    turn: number;
  } | null;
  lastQuickReplies: string[];
  sentimentTrail: Sentiment[]; // ۵ آخر
  irrelevantStreak: number;
  lastCustomerMessageAt: string | null; // ISO
};

// سقف‌های حافظه (ثابت در کد، طبق عادت پروژه)
export const MEMORY_LIMITS = {
  objections: 6,
  interests: 8,
  askedQuestions: 8,
  preferences: 6,
  dealBreakers: 4,
  sentimentTrail: 5,
  objectionQuoteChars: 120,
} as const;

// §۷.۱ — ورودی‌های سرور به ماشین‌حالت
export type ServerFacts = {
  conversationState: ConversationState;
  cartItemCount: number;
  leadCaptureOnly: boolean;
  catalogSize: number;
  hasWebsiteUrl: boolean;
  nowIso: string;
};

// §۷.۴
export type SalesToolName =
  | 'search_products'
  | 'get_product_details'
  | 'update_cart'
  | 'view_cart'
  | 'apply_discount'
  | 'create_order'
  | 'capture_lead'
  | 'cancel_order'
  | 'check_order_status'
  | 'answer_faq'
  | 'request_human_handoff'
  | 'show_product_photos'
  | 'compare_products'
  | 'respond_to_customer';

// §۷.۳
export type SalesDecision = {
  stage: SalesStage;
  goal: TurnGoal;
  reason: string; // کد کوتاه قانون، مثلاً 'R6_OBJECTION_PRICE'
  focusObjection: ObjectionRecord | null;
  welcomeBack: boolean;
  shortCircuit: 'HUMAN_HANDOFF' | 'SPAM_REPLY' | null;
  allowedTools: SalesToolName[];
};

// §۸ — قرارداد پاسخ هر هدف
export type ReplyContract = {
  maxChars: number;
  maxQuestions: 0 | 1;
  requireProducts: 'NONE' | 'FORBIDDEN' | 'ONE_OR_TWO';
  requireQuickReplies: boolean;
  mustEndWithNextStep: boolean;
};

// §۱۳ — فانل لید مشتق‌شده از مرحله (LEAD_CAPTURED فقط توسط captureLead ست می‌شود)
export type DerivedLeadFunnelStage =
  | 'NEW'
  | 'DISCOVERING_NEED'
  | 'PITCHED'
  | 'OBJECTION_RAISED'
  | 'READY_TO_CAPTURE'
  | 'NOT_RELEVANT';
