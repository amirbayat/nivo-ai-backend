import type { ConversationState } from '@prisma/client';
import type { BuyerNeedTag, ParsedIntent } from './sales-agent.types';

// docs/PRD-sales-agent-implicit-need-detection.md بخش ۵ — فاز ۰: این eval-set قبل از هر
// تغییری در buildIntentClassificationPrompt/intentClassificationSchema ساخته شده تا یک
// baseline واقعی از رفتار «فعلی» (بدون needType/storeRelevance/pitchReadiness) ثبت شود. همان
// الگوی INTENT_GOLDEN_CASES (intent-golden-cases.ts)، با یک تفاوت مهم: چون طبقه‌بندی هنوز به
// context فروشگاه/کاتالوگ دسترسی ندارد (نه امروز، نه در فاز ۱ که فقط فیلدهای Zod را اضافه
// می‌کند، نه پرامپت را به یک فروشگاه خاص وصل می‌کند)، فیلد `storeContext` فقط برای مستندسازی و
// بازبینی دستی نتایج است — توسط runImplicitNeedGoldenSet فعلاً به پرامپت تزریق نمی‌شود.
//
// expectedIntent/expectedBuyerNeeds پاسخ «درست»ِ نهایی (هدف) را نشان می‌دهند، نه الزاماً چیزی که
// سیستم فعلی امروز تولید می‌کند — دقیقاً مثل INTENT_GOLDEN_CASES. انتظار صریح: روی baseline فاز
// ۰، بیشتر موارد دسته‌ی «هدف ضمنی مرتبط» و «هدف نامرتبط» fail می‌شوند (همان باگ ریشه‌ای سند)؛
// هدف فاز ۰ ثبت دقیق همین شکست‌هاست، نه رفع آن‌ها.
export type ImplicitNeedCategory =
  | 'RELEVANT_IMPLICIT_GOAL' // هدف ضمنی مرتبط
  | 'EXPLICIT_REQUEST' // درخواست صریح (گروه کنترل — باید همین الان هم درست کار کند)
  | 'AMBIGUOUS_GOAL' // هدف مبهم
  | 'IRRELEVANT_GOAL' // هدف نامرتبط
  | 'MISMATCHED_PRODUCT' // محصول نامناسب (نیازمند context فروشگاه — فعلاً غیرقابل‌سنجش کامل)
  | 'PURE_INFO_REQUEST' // درخواست اطلاعات صرف
  | 'MID_CONVERSATION_SHIFT' // تغییر نیاز وسط مکالمه
  | 'NON_PURCHASE_MESSAGE'; // پیام غیرخریدی

export interface ImplicitNeedGoldenCase {
  id: string;
  category: ImplicitNeedCategory;
  message: string;
  state?: ConversationState;
  // فقط مستندسازی/بازبینی دستی — امروز به پرامپت داده نمی‌شود (بالا را ببین)
  storeContext?: string;
  expectedIntent: ParsedIntent['intent'];
  expectedBuyerNeeds?: BuyerNeedTag[];
  // اگر true باشد یعنی سنجش کامل این مورد وابسته به چیزی است که هنوز وجود ندارد (مثلاً
  // storeRelevance/pitchReadiness فاز ۱ یا تاریخچه‌ی چندنوبتی مکالمه) — runImplicitNeedGoldenSet
  // این را در نتیجه منعکس می‌کند تا با «واقعاً fail شد» قاطی نشود
  notFullyMeasurableYet?: boolean;
  notes: string;
}

export const IMPLICIT_NEED_GOLDEN_CASES: ImplicitNeedGoldenCase[] = [
  // ── هدف ضمنی مرتبط ───────────────────────────────────────────────────────
  {
    id: 'n1',
    category: 'RELEVANT_IMPLICIT_GOAL',
    message: 'میخوام برم فرانت اند دولوپر بشم',
    storeContext: 'فروشگاه آموزش React/فرانت‌اند می‌فروشد',
    expectedIntent: 'BROWSE',
    notes:
      'نمونه‌ی ریشه‌ای این سند — نباید OFF_TOPIC_OR_SPAM بگیرد و نباید به پاسخ عمومی «متوجه نشدم» ختم شود',
  },
  {
    id: 'n2',
    category: 'RELEVANT_IMPLICIT_GOAL',
    message: 'استخدامی جدیدا سخته، میخوام رزومه‌م قوی‌تر شه',
    storeContext: 'فروشگاه دوره‌های برنامه‌نویسی/مهارت‌آموزی می‌فروشد',
    expectedIntent: 'BROWSE',
    notes: 'هدف شغلی ضمنی، بدون اسم بردن از هیچ محصول/دوره‌ی خاص',
  },
  {
    id: 'n3',
    category: 'RELEVANT_IMPLICIT_GOAL',
    message: 'پوست صورتم این اواخر خیلی جوش میزنه، چیکار کنم خوب شه',
    storeContext: 'فروشگاه لوازم آرایشی/مراقبت پوست می‌فروشد',
    expectedIntent: 'BROWSE',
    expectedBuyerNeeds: ['PRODUCT_RECOMMENDATION'],
    notes: 'نیاز ضمنی در حوزه‌ی غیرآموزشی هم باید همین رفتار را بگیرد',
  },

  // ── درخواست صریح (گروه کنترل) ────────────────────────────────────────────
  {
    id: 'n4',
    category: 'EXPLICIT_REQUEST',
    message: 'یه دوره React میخوام',
    expectedIntent: 'BROWSE',
    notes:
      'مسیر فعلی — نباید با تغییرات فاز ۱ به بعد خراب شود (regression guard)',
  },
  {
    id: 'n5',
    category: 'EXPLICIT_REQUEST',
    message: 'همین کرم مرطوب‌کننده رو میخوام بخرم',
    expectedIntent: 'ADD_TO_CART',
    notes: 'درخواست صریح با نام محصول — باید دست‌نخورده بماند',
  },

  // ── هدف مبهم ──────────────────────────────────────────────────────────────
  {
    id: 'n6',
    category: 'AMBIGUOUS_GOAL',
    message: 'میخوام برنامه‌نویسی یاد بگیرم',
    storeContext: 'فروشگاه چند دوره‌ی مختلف (پایتون، React، دیتا) دارد',
    expectedIntent: 'BROWSE',
    notFullyMeasurableYet: true,
    notes:
      'رفتار ایده‌آل یک سوال مشخص‌کننده است (کدام زمینه؟)؛ امروز intent=BROWSE قابل قبول است ولی «سوال هدفمند پرسیدن» با schema فعلی قابل سنجش نیست (نیازمند pitchReadiness فاز ۱)',
  },
  {
    id: 'n7',
    category: 'AMBIGUOUS_GOAL',
    message: 'یه چیزی میخوام بگیرم ولی نمیدونم چی',
    expectedIntent: 'BROWSE',
    notFullyMeasurableYet: true,
    notes: 'مشابه n6 — هدف هست ولی خیلی کلی',
  },

  // ── هدف نامرتبط ───────────────────────────────────────────────────────────
  {
    id: 'n8',
    category: 'IRRELEVANT_GOAL',
    message: 'میخوام مهاجرت کنم',
    storeContext: 'فروشگاه دوره‌ی React می‌فروشد',
    expectedIntent: 'UNCLEAR',
    expectedBuyerNeeds: [],
    notes:
      'هدف شخصیِ واقعی ولی کاملاً نامرتبط با فروشگاه — نباید OFF_TOPIC_OR_SPAM بگیرد (آن تگ برای اسپم/تبلیغ است، نه هر پیام نامرتبط)؛ نباید پیشنهاد اجباری بدهد',
  },
  {
    id: 'n9',
    category: 'IRRELEVANT_GOAL',
    message: 'امشب فوتبال رو دیدی؟ چه بازی‌ای بود',
    expectedIntent: 'UNCLEAR',
    expectedBuyerNeeds: [],
    notes: 'گپ عادی نامرتبط — نه اسپم، نه نیاز خرید',
  },

  // ── محصول نامناسب (وابسته به context فروشگاه — فعلاً غیرقابل‌سنجش کامل) ───
  {
    id: 'n10',
    category: 'MISMATCHED_PRODUCT',
    message: 'میخوام فرانت‌اند بشم',
    storeContext:
      'فروشگاه فقط دوره‌ی پایتون/بک‌اند دارد (هیچ دوره‌ی فرانت‌اندی ندارد)',
    expectedIntent: 'BROWSE',
    notFullyMeasurableYet: true,
    notes:
      'باید fit واقعی بسنجد نه فقط ارتباط کلی حوزه («آموزش برنامه‌نویسی»)؛ سنجش واقعی نیازمند کاتالوگ واقعی فروشگاه در پرامپت است (فاز ۴.۲) — امروز قابل اجرا نیست، فقط برای مستندسازی اینجاست',
  },

  // ── درخواست اطلاعات صرف ──────────────────────────────────────────────────
  {
    id: 'n11',
    category: 'PURE_INFO_REQUEST',
    message: 'دوره‌تون چند ساعته؟',
    expectedIntent: 'ASK_FAQ',
    expectedBuyerNeeds: ['PRODUCT_SPEC'],
    notes: 'باید از همین امروز کار کند — گروه کنترل',
  },
  {
    id: 'n12',
    category: 'PURE_INFO_REQUEST',
    message: 'این دوره آنلاینه یا حضوری؟',
    expectedIntent: 'ASK_FAQ',
    notes: 'سوال اطلاعاتی صرف، بدون سیگنال هدف شخصی',
  },

  // ── تغییر نیاز وسط مکالمه ─────────────────────────────────────────────────
  {
    id: 'n13',
    category: 'MID_CONVERSATION_SHIFT',
    message: 'راستش نه، بیخیال پایتون، بیشتر دنبال React ام',
    state: 'BROWSING',
    storeContext: 'مشتری قبلاً در مورد دوره‌ی پایتون صحبت کرده بود',
    expectedIntent: 'BROWSE',
    notFullyMeasurableYet: true,
    notes:
      'سنجش واقعی نیازمند تاریخچه‌ی چندنوبتی مکالمه است که runImplicitNeedGoldenSet فعلی (مثل runIntentGoldenSet) ندارد؛ فقط پیام مجزا تست می‌شود',
  },
  {
    id: 'n14',
    category: 'MID_CONVERSATION_SHIFT',
    message: 'در واقع برای خودم نمیخوام، میخوام برای دخترم بگیرم که دانشجوعه',
    expectedIntent: 'BROWSE',
    notFullyMeasurableYet: true,
    notes: 'تغییر ذی‌نفع نیاز وسط مکالمه',
  },

  // ── پیام غیرخریدی ─────────────────────────────────────────────────────────
  {
    id: 'n15',
    category: 'NON_PURCHASE_MESSAGE',
    message: 'امروز حوصله ندارم',
    expectedIntent: 'UNCLEAR',
    expectedBuyerNeeds: [],
    notes: 'نباید فروش اجباری/پیشنهاد بی‌ربط بدهد؛ مکالمه‌ی عادی کافی است',
  },
  {
    id: 'n16',
    category: 'NON_PURCHASE_MESSAGE',
    message: 'سلام خوبی؟ چه خبر',
    expectedIntent: 'UNCLEAR',
    expectedBuyerNeeds: [],
    notes: 'احوال‌پرسی صرف — نه BROWSE، نه OFF_TOPIC_OR_SPAM',
  },
];
