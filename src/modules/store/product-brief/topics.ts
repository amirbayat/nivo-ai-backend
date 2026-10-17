import { normForMatch } from './normalize';

export const BRIEF_TOPICS = [
  'OVERVIEW', 'SPECS', 'SIZE_FIT', 'VARIANTS_STOCK', 'CARE', 'USAGE_STYLING',
  'COMPARISON', 'POLICY', 'COMPATIBILITY', 'SELLER_RULES', 'OTHER',
] as const;
export type BriefTopic = (typeof BRIEF_TOPICS)[number];

// فرهنگ عنوان → موضوع (بدون LLM). ترتیب مهم است: مورد خاص‌تر اول.
const HEADING_TOPICS: Array<[RegExp, BriefTopic]> = [
  [/دستیار فروش|نکته (ای )?برای (دستیار|فروشنده)|راهنمای دستیار|دستور(ات)? (برای )?دستیار/, 'SELLER_RULES'],
  [/موجودی|رنگ ?(و|ها|بندی)? ?(و )?سایز|رنگ ?بندی|رنگ ?ها|رنگ و/, 'VARIANTS_STOCK'],
  [/سایز|اندازه|فیت|قد |جدول/, 'SIZE_FIT'],
  [/نگهداری|شست ?و ?شو|شستشو|مراقبت|اتو/, 'CARE'],
  [/تفاوت|مقایسه|فرق/, 'COMPARISON'],
  [/ارسال|مرجوع|گارانتی|ضمانت|اصالت|بازگشت/, 'POLICY'],
  [/سازگار/, 'COMPATIBILITY'],
  [/مناسب|ست کردن|استایل|کاربرد|نحوه استفاده|راهنمای استفاده|طرز استفاده/, 'USAGE_STYLING'],
  [/مشخصات|ویژگی|جنس|ترکیب|ابعاد/, 'SPECS'],
  [/معرفی|درباره|توضیح/, 'OVERVIEW'],
];

export function topicFromHeading(heading: string | null | undefined): BriefTopic | null {
  if (!heading) return null;
  const h = normForMatch(heading).replace(/[:：]+$/, '');
  for (const [re, topic] of HEADING_TOPICS) if (re.test(h)) return topic;
  return null;
}

// کلیدواژه‌ی پشتیبان روی پیام خریدار (بند ۱۶.۲)
const MESSAGE_KEYWORDS: Array<[RegExp, BriefTopic]> = [
  [/سایز|قد|کمر|باسن|دور سینه|اندازه|فیت|سایزبندی/, 'SIZE_FIT'],
  [/جنس|پارچه|نخ|ضخامت|ترکیب|چیه جنسش/, 'SPECS'],
  [/شستشو|شست ?و ?شو|اتو|لک|بشورم|مراقبت/, 'CARE'],
  [/ست |مجلسی|با چی بپوشم|بپوشم|مهمونی|مهمانی|استایل/, 'USAGE_STYLING'],
  [/فرق|مقایسه|بهتره|تفاوت/, 'COMPARISON'],
];

export function topicsForMessage(message: string): BriefTopic[] {
  const m = normForMatch(message);
  const out: BriefTopic[] = [];
  for (const [re, t] of MESSAGE_KEYWORDS) if (re.test(m) && !out.includes(t)) out.push(t);
  return out;
}

// نگاشت buyerNeeds → موضوع (مسیر state machine)
export const BUYER_NEED_TOPICS: Record<string, BriefTopic[]> = {
  PRODUCT_SPEC: ['SPECS', 'SIZE_FIT'],
  USAGE_GUIDE: ['USAGE_STYLING', 'CARE'],
  VARIANT_REQUEST: ['SIZE_FIT'],
  STOCK_CHECK: ['SIZE_FIT'],
  PRODUCT_COMPARISON: ['COMPARISON', 'SPECS'],
  PRODUCT_RECOMMENDATION: ['USAGE_STYLING', 'OVERVIEW'],
  ASK_COMPATIBILITY: ['COMPATIBILITY', 'SIZE_FIT'],
  ASK_AUTHENTICITY: ['POLICY'],
  ASK_WARRANTY_RETURN_POLICY: ['POLICY'],
  ASK_SHIPPING: ['POLICY'],
};
