// docs/PRD-sales-agent-sales-state-machine.md §۱۰ — پرامپت اجرا (Act): فقط دستورالعمل «همین یک
// هدف». تابع خالص است؛ هر چیزی که I/O لازم دارد (storeProfile، شواهد، کاندیدها) به‌صورت رشته‌ی
// آماده از engine می‌آید
import {
  GENERAL_REPLY_CONTRACT,
  PLAYBOOK,
  WELCOME_BACK_LINE,
  contractFor,
  objectionPlaybookText,
  renderTemplate,
} from './sales-playbook';
import type {
  ObjectionType,
  ProductInterest,
  SalesDecision,
  SalesMemory,
  SalesSlots,
  SalesStage,
  Sentiment,
  TurnGoal,
} from './sales-machine.types';

// §۱۰.۲ — برچسب‌های فارسی
export const STAGE_FA: Record<SalesStage, string> = {
  OPENING: 'شروع گفتگو',
  DISCOVERY: 'کشف نیاز',
  RECOMMENDATION: 'پیشنهاد محصول',
  EVALUATION: 'بررسی/مقایسه‌ی محصول',
  OBJECTION: 'اعتراض/تردید',
  CLOSING: 'نزدیک بستن',
  CHECKOUT: 'سبد/پرداخت',
  POST_PURCHASE: 'بعد از خرید',
  NOT_A_FIT: 'خارج از حوزه‌ی فروشگاه',
  DORMANT: 'مشتری عقب کشیده',
};

export const GOAL_FA: Record<TurnGoal, string> = {
  GREET_AND_OPEN: 'خوش‌آمد و شروع',
  DISCOVER_NEED: 'کشف نیاز (یک سؤال)',
  RECOMMEND: 'پیشنهاد دقیق',
  ANSWER_AND_ADVANCE: 'جواب دقیق و یک قدم جلو',
  HANDLE_OBJECTION: 'مدیریت اعتراض',
  TRIAL_CLOSE: 'سنجش آمادگی',
  ALTERNATIVE_CLOSE: 'بستن با دو گزینه',
  EXECUTE_PURCHASE: 'اجرای خرید',
  ASSIST_CHECKOUT: 'کمک به تکمیل خرید',
  POST_PURCHASE_CARE: 'مراقبت بعد از خرید',
  HONEST_NOT_A_FIT: 'صداقت: خارج از حوزه',
  SOFT_EXIT: 'خروج محترمانه',
};

export const OBJECTION_FA: Record<ObjectionType, string> = {
  PRICE: 'قیمت',
  TRUST: 'اعتماد',
  QUALITY: 'کیفیت',
  FIT: 'تناسب/اندازه',
  TIMING: 'زمان‌بندی',
  SHIPPING: 'ارسال',
  PAYMENT: 'پرداخت',
  COMPETITOR: 'رقیب',
  NEED_APPROVAL: 'نیاز به تایید دیگری',
  OTHER: 'سایر',
};

export const SENTIMENT_FA: Record<Sentiment, string> = {
  POSITIVE: 'مثبت',
  NEUTRAL: 'خنثی',
  NEGATIVE: 'ناراضی',
  FRUSTRATED: 'کلافه',
};

export const SLOT_LABEL_FA: Record<keyof SalesSlots, string> = {
  customerName: 'اسم',
  goal: 'هدف',
  recipient: 'برای',
  budgetMaxToman: 'بودجه (حداکثر تومان)',
  budgetMinToman: 'حداقل بودجه (تومان)',
  size: 'سایز',
  color: 'رنگ',
  preferences: 'ترجیحات',
  dealBreakers: 'حتماً نباشد',
  deadline: 'مهلت',
  experienceLevel: 'سطح',
  quantity: 'تعداد',
  province: 'استان',
};

const SIGNAL_FA: Record<ProductInterest['signal'], string> = {
  SHOWN: 'نشان داده‌ شده',
  ASKED: 'پرسیده',
  COMPARED: 'مقایسه کرده',
  IN_CART: 'در سبد',
  REJECTED: 'رد کرده',
};

const REQUIRE_PRODUCTS_FA = {
  NONE: 'معرفی محصول الزامی نیست',
  FORBIDDEN: 'محصول معرفی نکن و relevantProductIds خالی باشد',
  ONE_OR_TWO:
    '۱ یا ۲ محصول معرفی کن و شناسه‌شان را در relevantProductIds بگذار',
} as const;

export type SalesActPromptInput = {
  storeName: string;
  tone: string; // toneForCategory(store.category)
  storeProfile: string; // همان storeProfile فعلی engine (category، معرفی، ارسال، مرجوعی، ...)
  paymentMethodsLine: string; // «روش‌های پرداخت: کارت‌به‌کارت، اسنپ‌پی (۴ قسط)»
  mem: SalesMemory;
  decision: SalesDecision;
  cartSummary: string; // سبد فعلی با جمع واقعی
  catalogSize: number;
  evidence: string | null; // §۹ «پشتیبانی کد»؛ فقط برای اهداف مجاز
  candidatesText: string | null; // §۱۰.۳
  fallbackCatalogText: string | null; // «چند نمونه از کاتالوگ» وقتی کاندیدی نیست
  persuasionInstruction: string | null; // فقط وقتی فروشگاه persuasion را روشن کرده
  leadCaptureInstruction: string | null; // فقط leadCaptureOnly
};

export const EVIDENCE_GOALS: TurnGoal[] = [
  'HANDLE_OBJECTION',
  'RECOMMEND',
  'TRIAL_CLOSE',
  'ALTERNATIVE_CLOSE',
];
const PERSUASION_GOALS = EVIDENCE_GOALS;

const HARD_RULES = (
  storeName: string,
  tone: string,
) => `تو فروشنده‌ی باتجربه و خوش‌برخورد فروشگاه «${storeName}» در دایرکت هستی — مثل بهترین فروشنده‌ای که
مشتری‌ها دوست دارند دوباره سراغش بیایند: گوش می‌دهد، یادش می‌ماند، دقیق جواب می‌دهد، چیز درست را
پیشنهاد می‌کند، فشار بی‌جا نمی‌آورد. لحن: ${tone}.

قوانین غیرقابل‌مذاکره:
۱. هیچ قیمت، موجودی، تخفیف، زمان ارسال، اسم یا عددی را که از ابزارها یا اطلاعات پایین نیامده نگو.
۲. تعداد دقیق موجودی را نگو؛ فقط «موجوده» یا «فعلاً تموم شده».
۳. کدهای تخفیف و شناسه‌ها را حرف‌به‌حرف همان‌طور که از ابزار آمده بنویس.
۴. تغییر سبد فقط با update_cart، ثبت سفارش فقط با create_order — هرگز فقط در متن ادعا نکن.
۵. صداقت هویت: اگر مشتری پرسید ربات/هوش مصنوعی هستی، صادقانه بگو دستیار هوشمند همین فروشگاه هستی و اگر
   بخواهد می‌تواند با خود فروشنده هم صحبت کند. هرگز ادعای انسان‌بودن نکن.
۶. در پایان دقیقاً یک‌بار respond_to_customer را صدا بزن — مگر بعد از create_order، update_cart برای محصول
   دارای سایز/رنگ، capture_lead یا request_human_handoff که سیستم خودش ادامه می‌دهد.
۷. relevantProductIds فقط محصولاتی که واقعاً در متن همین پاسخ معرفی کرده‌ای.`;

function describeKnown(mem: SalesMemory, cartSummary: string): string {
  const lines: string[] = [];
  lines.push(`- نیاز: ${mem.needSummary ?? 'هنوز معلوم نیست'}`);
  for (const key of Object.keys(SLOT_LABEL_FA) as (keyof SalesSlots)[]) {
    const v = mem.slots[key];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`- ${SLOT_LABEL_FA[key]}: ${v.join('، ')}`);
    } else {
      lines.push(`- ${SLOT_LABEL_FA[key]}: ${String(v)}`);
    }
  }
  const seen = mem.interests.filter((i) => i.signal !== 'REJECTED');
  if (seen.length) {
    lines.push(
      `- محصولاتی که دیده/پرسیده: ${seen
        .map(
          (i) =>
            `${i.name}${i.priceToman > 0 ? ` — ${i.priceToman} تومان` : ''} (${SIGNAL_FA[i.signal]})`,
        )
        .join('؛ ')}`,
    );
  }
  const rejected = mem.interests.filter((i) => i.signal === 'REJECTED');
  if (rejected.length) {
    lines.push(
      `- رد کرده: ${rejected
        .map((i) => `${i.name}${i.note ? ` (دلیل: ${i.note})` : ''}`)
        .join('؛ ')}`,
    );
  }
  if (mem.objections.length) {
    lines.push(
      `- اعتراض‌ها: ${mem.objections
        .map((o) => `${OBJECTION_FA[o.type]}: ${o.status} — «${o.quote}»`)
        .join('؛ ')}`,
    );
  }
  const lastSentiment = mem.sentimentTrail[mem.sentimentTrail.length - 1];
  if (lastSentiment) lines.push(`- حال‌وهوا: ${SENTIMENT_FA[lastSentiment]}`);
  lines.push(`- سبد: ${cartSummary}`);
  if (mem.askedQuestions.length) {
    lines.push(
      `- سؤال‌هایی که قبلاً پرسیده‌ای (تکرار نکن): ${mem.askedQuestions
        .map((q) => `«${q.text}»`)
        .join('؛ ')}`,
    );
  }
  return `آنچه از مشتری می‌دانیم:\n${lines.join('\n')}`;
}

function instructionVars(
  input: SalesActPromptInput,
): Record<string, string | number> {
  const { mem, decision } = input;
  const focus = decision.focusObjection;
  const target = mem.lastCloseOffer?.productIds.length
    ? mem.interests
        .filter((i) => mem.lastCloseOffer!.productIds.includes(i.id))
        .map((i) => `${i.name} [شناسه: ${i.id}]`)
        .join('، ')
    : mem.interests
        .filter((i) => i.signal === 'ASKED')
        .slice(-1)
        .map((i) => `${i.name} [شناسه: ${i.id}]`)
        .join('، ');
  return {
    discoveryNo: mem.discoveryQuestionsAsked + 1,
    discoveryRemaining: Math.max(0, 2 - (mem.discoveryQuestionsAsked + 1)),
    objectionType: focus ? OBJECTION_FA[focus.type] : '',
    objectionQuote: focus?.quote ?? '',
    objectionAttemptNo: focus ? focus.attempts + 1 : 1,
    objectionPlaybook: focus ? objectionPlaybookText(focus.type) : '',
    purchaseTarget: target || 'همان محصولی که در گفتگو مطرح بود',
    storeDomain: input.storeName,
  };
}

export function buildSalesActSystemPrompt(input: SalesActPromptInput): string {
  const { decision } = input;
  const goal = decision.goal;
  const playbook = PLAYBOOK[goal];
  const contract = contractFor(goal, input.catalogSize);
  const parts: string[] = [];

  // ثابت‌ها اول، برای prompt caching
  parts.push(HARD_RULES(input.storeName, input.tone));
  parts.push(`${input.storeProfile}\n${input.paymentMethodsLine}`.trim());
  parts.push(
    `${GENERAL_REPLY_CONTRACT}${decision.welcomeBack ? `\n${WELCOME_BACK_LINE}` : ''}`,
  );
  parts.push(describeKnown(input.mem, input.cartSummary));

  parts.push(
    `مرحله‌ی فعلی فروش: ${STAGE_FA[decision.stage]}
هدف همین نوبت: ${GOAL_FA[goal]}
${renderTemplate(playbook.instruction, instructionVars(input))}
قرارداد این پاسخ: حداکثر ${contract.maxChars} کاراکتر؛ حداکثر ${contract.maxQuestions} سؤال؛ ${REQUIRE_PRODUCTS_FA[contract.requireProducts]}؛
${contract.requireQuickReplies ? '۲ تا ۳ گزینه‌ی کوتاه (حداکثر ۲۵ کاراکتر) در quickReplies' : 'quickReplies خالی'}.`,
  );

  if (EVIDENCE_GOALS.includes(goal) && input.evidence) {
    parts.push(`شواهد واقعی در دسترس:\n${input.evidence}`);
  }

  if (input.candidatesText) {
    parts.push(
      `محصولات کاندید (سرور از قبل پیدا کرده):\n${input.candidatesText}`,
    );
  } else if (input.fallbackCatalogText) {
    parts.push(`چند نمونه از کاتالوگ:\n${input.fallbackCatalogText}`);
  }

  if (input.persuasionInstruction && PERSUASION_GOALS.includes(goal)) {
    parts.push(input.persuasionInstruction);
  }
  if (input.leadCaptureInstruction) parts.push(input.leadCaptureInstruction);

  return parts.join('\n\n');
}
