import type { ConversationState } from '@prisma/client';
import type { BuyerNeedTag, ParsedIntent } from './sales-agent.types';

// docs/PRD-sales-agent-implicit-need-detection.md بخش ۵ — فاز ۰ این eval-set را (قبل از هر
// تغییری در buildIntentClassificationPrompt/intentClassificationSchema) ساخت تا baseline واقعیِ
// رفتار «قبلی» ثبت شود. از فاز ۱ به بعد، همان فایل به‌روزرسانی شده: schema واقعی الان
// needType/implicitNeedSummary/storeRelevance/pitchReadiness را برمی‌گرداند، و
// buildIntentClassificationPrompt یک پارامتر دوم (storeContextSummary) می‌گیرد — پس
// `storeContext` پایین دیگر فقط مستندسازی نیست، واقعاً توسط runImplicitNeedGoldenSet به پرامپت
// تزریق می‌شود (همان الگوی INTENT_GOLDEN_CASES، با این فیلد/گریدینگ‌های اضافه).
//
// expectedIntent/expectedBuyerNeeds/expectedNeedType/... پاسخ «درست»ِ نهایی (هدف) را نشان
// می‌دهند، نه الزاماً چیزی که سیستم امروز تولید می‌کند. برای مواردی که قضاوت صحیحش ذاتاً مبهم/
// سلیقه‌ای است (مثلاً PURE_INFO_REQUEST)، عمداً expectedNeedType/... ست نشده تا یک fail کاذب
// روی یک قضاوت غیرقطعی تولید نشود — فقط expectedIntent/expectedBuyerNeeds (دقیق‌تر) چک می‌شوند.
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
  // جمله‌ی کوتاه فارسی درباره‌ی اینکه فروشگاه چه می‌فروشد — مستقیماً به‌عنوان
  // storeContextSummary به buildIntentClassificationPrompt داده می‌شود
  storeContext?: string;
  expectedIntent: ParsedIntent['intent'];
  expectedBuyerNeeds?: BuyerNeedTag[];
  expectedNeedType?: NonNullable<ParsedIntent['needType']>;
  expectedStoreRelevance?: NonNullable<ParsedIntent['storeRelevance']>;
  expectedPitchReadiness?: NonNullable<ParsedIntent['pitchReadiness']>;
  // اگر true باشد یعنی سنجش کامل این مورد وابسته به چیزی است که هنوز وجود ندارد (مثلاً کاتالوگ
  // واقعی فروشگاه برای fit-check دقیق — فاز ۴.۲ — یا تاریخچه‌ی چندنوبتی مکالمه که
  // runImplicitNeedGoldenSet مثل runIntentGoldenSet فقط یک پیام مجزا تست می‌کند، نه کل مکالمه)
  notFullyMeasurableYet?: boolean;
  notes: string;
}

export const IMPLICIT_NEED_GOLDEN_CASES: ImplicitNeedGoldenCase[] = [
  // ── هدف ضمنی مرتبط ───────────────────────────────────────────────────────
  {
    id: 'n1',
    category: 'RELEVANT_IMPLICIT_GOAL',
    message: 'میخوام برم فرانت اند دولوپر بشم',
    storeContext: 'این فروشگاه آموزش React/فرانت‌اند می‌فروشد',
    expectedIntent: 'BROWSE',
    expectedNeedType: 'IMPLICIT',
    expectedStoreRelevance: 'RELEVANT',
    expectedPitchReadiness: 'READY',
    notes:
      'نمونه‌ی ریشه‌ای این سند — نباید OFF_TOPIC_OR_SPAM بگیرد و نباید به پاسخ عمومی «متوجه نشدم» ختم شود',
  },
  {
    id: 'n2',
    category: 'RELEVANT_IMPLICIT_GOAL',
    message: 'استخدامی جدیدا سخته، میخوام رزومه‌م قوی‌تر شه',
    storeContext: 'این فروشگاه دوره‌های برنامه‌نویسی/مهارت‌آموزی می‌فروشد',
    expectedIntent: 'BROWSE',
    expectedNeedType: 'IMPLICIT',
    expectedStoreRelevance: 'RELEVANT',
    notes: 'هدف شغلی ضمنی، بدون اسم بردن از هیچ محصول/دوره‌ی خاص',
  },
  {
    id: 'n3',
    category: 'RELEVANT_IMPLICIT_GOAL',
    message: 'پوست صورتم این اواخر خیلی جوش میزنه، چیکار کنم خوب شه',
    storeContext: 'این فروشگاه لوازم آرایشی/مراقبت پوست می‌فروشد',
    expectedIntent: 'BROWSE',
    expectedBuyerNeeds: ['PRODUCT_RECOMMENDATION'],
    expectedNeedType: 'IMPLICIT',
    expectedStoreRelevance: 'RELEVANT',
    notes: 'نیاز ضمنی در حوزه‌ی غیرآموزشی هم باید همین رفتار را بگیرد',
  },

  // ── درخواست صریح (گروه کنترل) ────────────────────────────────────────────
  {
    id: 'n4',
    category: 'EXPLICIT_REQUEST',
    message: 'یه دوره React میخوام',
    expectedIntent: 'BROWSE',
    expectedNeedType: 'EXPLICIT',
    notes:
      'مسیر فعلی — نباید با تغییرات فاز ۱ به بعد خراب شود (regression guard)',
  },
  {
    id: 'n5',
    category: 'EXPLICIT_REQUEST',
    message: 'همین کرم مرطوب‌کننده رو میخوام بخرم',
    expectedIntent: 'ADD_TO_CART',
    expectedNeedType: 'EXPLICIT',
    notes: 'درخواست صریح با نام محصول — باید دست‌نخورده بماند',
  },

  // ── هدف مبهم ──────────────────────────────────────────────────────────────
  {
    id: 'n6',
    category: 'AMBIGUOUS_GOAL',
    message: 'میخوام برنامه‌نویسی یاد بگیرم',
    storeContext:
      'این فروشگاه چند دوره‌ی خیلی متفاوت (پایتون، React، دیتا) دارد',
    expectedIntent: 'BROWSE',
    expectedNeedType: 'IMPLICIT',
    expectedStoreRelevance: 'RELEVANT',
    expectedPitchReadiness: 'NEEDS_CLARIFICATION',
    notes:
      'رفتار ایده‌آل یک سوال مشخص‌کننده است (کدام زمینه؟) نه حدس کورکورانه — از فاز ۱ با pitchReadiness قابل سنجش شد؛ استفاده‌ی واقعی از این سیگنال برای پرسیدن سوال هنوز فاز ۴ (پل‌زدن در پاسخ‌دهی) است',
  },
  {
    id: 'n7',
    category: 'AMBIGUOUS_GOAL',
    message: 'یه چیزی میخوام بگیرم ولی نمیدونم چی',
    expectedIntent: 'BROWSE',
    expectedNeedType: 'IMPLICIT',
    notes:
      'مشابه n6 — هدف هست ولی خیلی کلی؛ بدون storeContext مشخص، storeRelevance را چک نمی‌کنیم',
  },

  // ── هدف نامرتبط ───────────────────────────────────────────────────────────
  {
    id: 'n8',
    category: 'IRRELEVANT_GOAL',
    message: 'میخوام مهاجرت کنم',
    storeContext: 'این فروشگاه فقط دوره‌ی React می‌فروشد',
    expectedIntent: 'UNCLEAR',
    expectedBuyerNeeds: [],
    expectedNeedType: 'IMPLICIT',
    expectedStoreRelevance: 'NOT_RELEVANT',
    expectedPitchReadiness: 'NOT_READY',
    notes:
      'هدف شخصیِ واقعی ولی کاملاً نامرتبط با فروشگاه — نباید OFF_TOPIC_OR_SPAM بگیرد (آن تگ برای اسپم/تبلیغ است، نه هر پیام نامرتبط)؛ نباید پیشنهاد اجباری بدهد',
  },
  {
    id: 'n9',
    category: 'IRRELEVANT_GOAL',
    message: 'امشب فوتبال رو دیدی؟ چه بازی‌ای بود',
    expectedIntent: 'UNCLEAR',
    expectedBuyerNeeds: [],
    expectedNeedType: 'NONE',
    expectedStoreRelevance: 'NOT_RELEVANT',
    notes: 'گپ عادی نامرتبط — نه اسپم، نه نیاز خرید',
  },

  // ── محصول نامناسب (وابسته به context فروشگاه — فعلاً غیرقابل‌سنجش کامل) ───
  {
    id: 'n10',
    category: 'MISMATCHED_PRODUCT',
    message: 'میخوام فرانت‌اند بشم',
    storeContext:
      'این فروشگاه فقط دوره‌ی پایتون/بک‌اند دارد (هیچ دوره‌ی فرانت‌اندی ندارد)',
    expectedIntent: 'BROWSE',
    notFullyMeasurableYet: true,
    notes:
      'storeContext اینجا عمداً دقیق‌تر از چیزی است که در تولید واقعی در اختیار طبقه‌بندی قرار می‌گیرد (فقط store.category/brandIntro کلی، نه فهرست دقیق «چه دوره‌ای نداریم») — سنجش واقعی fit نیازمند کاتالوگ واقعی فروشگاه در خودِ doBrowse است (فاز ۴.۲)، نه این فراخوان طبقه‌بندی',
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
    expectedNeedType: 'NONE',
    expectedStoreRelevance: 'NOT_RELEVANT',
    notes: 'نباید فروش اجباری/پیشنهاد بی‌ربط بدهد؛ مکالمه‌ی عادی کافی است',
  },
  {
    id: 'n16',
    category: 'NON_PURCHASE_MESSAGE',
    message: 'سلام خوبی؟ چه خبر',
    expectedIntent: 'UNCLEAR',
    expectedBuyerNeeds: [],
    expectedNeedType: 'NONE',
    expectedStoreRelevance: 'NOT_RELEVANT',
    notes: 'احوال‌پرسی صرف — نه BROWSE، نه OFF_TOPIC_OR_SPAM',
  },
];
