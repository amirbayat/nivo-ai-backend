import { normalizeFa } from './normalize';

// ACE-9 — آیا پیام برای فهمیده‌شدن به گفتگو وابسته است؟ بله → هیچ لایه‌ی کش/قطعی دخالت نمی‌کند.
export interface DependenceInput {
  text: string;
  currentState?: string | null;
  // آیا پیام قبلی بات یک سؤال بود؟ (برای «آره/نه/باشه»)
  lastBotAskedQuestion?: boolean;
  // پیام اسم محصول را صریح آورده («این مانتو چنده؟») → ضمیر به‌تنهایی وابستگی نیست
  mentionsProduct?: boolean;
}

const REFERENTIAL = /(^| )(این|اون|همین|اینم|اونم|اینو|اونو|اینه|اونه|اینا|اونا|اونی که گفتی|قبلی|بالایی|پایینی|اولی|دومی|سومی|همونی)( |$)/;
const ANSWER_ONLY = /^(آره|اره|بله|نه|باشه|ok|اوکی|اکی|خب|خوبه|حتما|نخیر|اره دیگه|آره دیگه)( ?\?)?$/;
const ONLY_NUMBER = /^\d+( ?\?)?$/;
const CONTINUATION = /^(و|ولی|اما|پس|یعنی|خب پس|راستی|اگه|اگر|بعدش|وگرنه) /;
const MULTI = /\?.*\?|و همینطور|و همچنین|ضمنا|یه سوال دیگه/;
const CHECKOUT_STATES = new Set(['CART', 'CHECKOUT', 'ADDRESS_COLLECTION', 'PAYMENT_METHOD_SELECTION', 'AWAITING_PAYMENT', 'AWAITING_SELLER_APPROVAL']);

export function isContextDependent(input: DependenceInput): boolean {
  const n = normalizeFa(input.text);
  if (!n) return true;
  if (input.currentState && CHECKOUT_STATES.has(input.currentState)) return true;
  if (!input.mentionsProduct && REFERENTIAL.test(n)) return true;
  if (ANSWER_ONLY.test(n)) return true;
  if (ONLY_NUMBER.test(n)) return true;
  if (CONTINUATION.test(n)) return true;
  if (MULTI.test(n)) return true;
  if (input.lastBotAskedQuestion && n.split(' ').length <= 2) return true;
  return false;
}
