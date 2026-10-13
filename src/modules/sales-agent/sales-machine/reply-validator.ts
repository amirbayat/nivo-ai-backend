// docs/PRD-sales-agent-sales-state-machine.md §۱۱ — اعتبارسنجی قطعی پاسخ قبل از ارسال. خالص است؛
// retry اصلاحی در engine انجام می‌شود (فقط وقتی جهشی رخ نداده)
import { BANNED_OPENERS, BANNED_PHRASES } from './sales-playbook';
import type {
  ReplyContract,
  SalesMemory,
  TurnGoal,
} from './sales-machine.types';

export type Violation =
  | { code: 'TOO_LONG'; actual: number; max: number }
  | { code: 'TOO_MANY_QUESTIONS'; actual: number; max: number }
  | { code: 'PRODUCTS_REQUIRED' }
  | { code: 'PRODUCTS_FORBIDDEN' }
  | { code: 'QUICK_REPLIES_REQUIRED' }
  | { code: 'NO_NEXT_STEP' }
  | { code: 'BANNED_PHRASE'; phrase: string }
  | { code: 'REPEATED_QUESTION'; question: string }
  | { code: 'REPEATED_OPENER' }
  | { code: 'MARKDOWN' }
  | { code: 'SUSPICIOUS_PRICE'; amounts: number[] }
  | { code: 'REJECTED_PRODUCT_RECOMMENDED'; productId: string };

const LENGTH_TOLERANCE = 1.25;
const NEXT_STEP_WINDOW = 120;
const REPEAT_SIMILARITY = 0.8;
const QUICK_REPLY_MAX_CHARS = 25;
const QUICK_REPLY_MAX_COUNT = 3;

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function toWesternDigits(input: string): string {
  return input.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

// ی/ي، ک/ك، همزه‌ها، اعراب و نیم‌فاصله یکسان می‌شوند تا تطبیق عبارت‌ها به املا وابسته نباشد
export function normalizeFa(input: string): string {
  return input
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[أإ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ة/g, 'ه')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/‌/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// همان منطق findSuspiciousPriceClaims قبلی engine — حالا تخلف است، نه فقط لاگ
export function findSuspiciousPriceClaims(
  text: string,
  knownAmounts: Set<number>,
): number[] {
  const normalized = toWesternDigits(text).replace(/[,٬]/g, '');
  const matches = normalized.matchAll(/(\d{3,})\s*تومان/g);
  const suspicious = new Set<number>();
  for (const m of matches) {
    const amount = Number(m[1]);
    if (!knownAmounts.has(amount)) suspicious.add(amount);
  }
  return [...suspicious];
}

const STOPWORDS = new Set(
  [
    'و',
    'که',
    'را',
    'از',
    'به',
    'با',
    'این',
    'اون',
    'یه',
    'رو',
    'هم',
    'تو',
    'من',
  ].map(normalizeFa),
);

function tokens(s: string): Set<string> {
  return new Set(
    normalizeFa(s)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(' ')
      .filter((t) => t && !STOPWORDS.has(t)),
  );
}

export function jaccard(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

function questionSentences(text: string): string[] {
  return text
    .split(/(?<=[؟?])/)
    .map((s) => s.trim())
    .filter((s) => /[؟?]$/.test(s));
}

const NEXT_STEP_VERBS = /(بگو|بفرست|بزن|انتخاب کن|بنویس|ثبت|بذارم|کنار بذارم)/;

export function validateReply(args: {
  text: string;
  relevantProductIds: string[];
  quickReplies: string[];
  contract: ReplyContract;
  mem: SalesMemory;
  lastAgentMessage: string | null;
  knownAmounts: Set<number>;
  catalogSize: number;
  mutationShortCircuited: boolean;
  askedQuestion?: string | null;
}): Violation[] {
  if (args.mutationShortCircuited) return [];
  const { text, contract, mem } = args;
  const out: Violation[] = [];
  const norm = normalizeFa(text);

  const max = contract.maxChars;
  if (text.length > max * LENGTH_TOLERANCE) {
    out.push({ code: 'TOO_LONG', actual: text.length, max });
  }

  const questionCount = (text.match(/[؟?]/g) ?? []).length;
  if (questionCount > contract.maxQuestions) {
    out.push({
      code: 'TOO_MANY_QUESTIONS',
      actual: questionCount,
      max: contract.maxQuestions,
    });
  }

  if (
    contract.requireProducts === 'ONE_OR_TWO' &&
    args.catalogSize > 0 &&
    args.relevantProductIds.length === 0
  ) {
    out.push({ code: 'PRODUCTS_REQUIRED' });
  }
  if (
    contract.requireProducts === 'FORBIDDEN' &&
    args.relevantProductIds.length > 0
  ) {
    out.push({ code: 'PRODUCTS_FORBIDDEN' });
  }

  if (contract.requireQuickReplies && args.quickReplies.length < 2) {
    out.push({ code: 'QUICK_REPLIES_REQUIRED' });
  }

  if (contract.mustEndWithNextStep && args.quickReplies.length === 0) {
    const tail = text.slice(-NEXT_STEP_WINDOW);
    if (!/[؟?]/.test(tail) && !NEXT_STEP_VERBS.test(normalizeFa(tail))) {
      out.push({ code: 'NO_NEXT_STEP' });
    }
  }

  for (const phrase of BANNED_PHRASES) {
    if (norm.includes(normalizeFa(phrase))) {
      out.push({ code: 'BANNED_PHRASE', phrase });
    }
  }
  for (const opener of BANNED_OPENERS) {
    if (norm.startsWith(normalizeFa(opener))) {
      out.push({ code: 'BANNED_PHRASE', phrase: `${opener}!` });
    }
  }

  const candidates = [
    ...(args.askedQuestion ? [args.askedQuestion] : []),
    ...questionSentences(text),
  ];
  const repeated = candidates.find((q) =>
    mem.askedQuestions.some((a) => jaccard(q, a.text) >= REPEAT_SIMILARITY),
  );
  if (repeated) out.push({ code: 'REPEATED_QUESTION', question: repeated });

  if (args.lastAgentMessage) {
    const first3 = (s: string) =>
      normalizeFa(s).split(' ').slice(0, 3).join(' ');
    const a = first3(text);
    const b = first3(args.lastAgentMessage);
    if (a.split(' ').length >= 3 && a === b) {
      out.push({ code: 'REPEATED_OPENER' });
    }
  }

  if (text.includes('**') || /^\s*#/m.test(text)) {
    out.push({ code: 'MARKDOWN' });
  }

  const suspicious = findSuspiciousPriceClaims(text, args.knownAmounts);
  if (suspicious.length) {
    out.push({ code: 'SUSPICIOUS_PRICE', amounts: suspicious });
  }

  const rejected = new Set(
    mem.interests.filter((i) => i.signal === 'REJECTED').map((i) => i.id),
  );
  for (const id of args.relevantProductIds) {
    if (rejected.has(id)) {
      out.push({ code: 'REJECTED_PRODUCT_RECOMMENDED', productId: id });
    }
  }

  return out;
}

function violationLine(v: Violation): string {
  switch (v.code) {
    case 'TOO_LONG':
      return `پیام خیلی بلند بود (${v.actual} کاراکتر)؛ کوتاهش کن، حداکثر ${v.max} کاراکتر.`;
    case 'TOO_MANY_QUESTIONS':
      return v.max === 0
        ? 'هیچ سؤالی نپرس.'
        : `فقط ${v.max} سؤال بپرس (الان ${v.actual} سؤال داشتی).`;
    case 'PRODUCTS_REQUIRED':
      return 'یک یا دو محصول مشخص معرفی کن و شناسه‌شان را در relevantProductIds بگذار.';
    case 'PRODUCTS_FORBIDDEN':
      return 'در این نوبت محصول معرفی نکن و relevantProductIds را خالی بگذار.';
    case 'QUICK_REPLIES_REQUIRED':
      return '۲ تا ۳ گزینه‌ی کوتاه در quickReplies بگذار.';
    case 'NO_NEXT_STEP':
      return 'پیام را با دقیقاً یک قدم بعدی مشخص (یک سؤال یا دعوت) تمام کن.';
    case 'BANNED_PHRASE':
      return `عبارت ممنوع «${v.phrase}» را حذف کن.`;
    case 'REPEATED_QUESTION':
      return `این سؤال قبلاً پرسیده شده («${v.question}»)؛ چیز دیگری بپرس یا از اطلاعات موجود استفاده کن.`;
    case 'REPEATED_OPENER':
      return 'شروع پیام شبیه پیام قبلی توست؛ جمله‌ی اول را متفاوت و مرتبط با حرف همین پیام مشتری بنویس.';
    case 'MARKDOWN':
      return 'از ** و # استفاده نکن؛ متن ساده بنویس.';
    case 'SUSPICIOUS_PRICE':
      return `این مبالغ در هیچ داده‌ی واقعی نیست: ${v.amounts.join('، ')} — فقط قیمت‌های واقعی ابزارها را بگو.`;
    case 'REJECTED_PRODUCT_RECOMMENDED':
      return 'محصولی که مشتری رد کرده بود را دوباره پیشنهاد دادی؛ محصول دیگری انتخاب کن.';
  }
}

export function buildCorrectiveInstruction(violations: Violation[]): string {
  const lines = violations.map((v) => `- ${violationLine(v)}`);
  return `پاسخ قبلی‌ات این مشکلات را داشت؛ دوباره بنویس و فقط این‌ها را اصلاح کن:\n${lines.join('\n')}`;
}

function truncateOnWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

const NO_QUICK_REPLY_GOALS: TurnGoal[] = [
  'EXECUTE_PURCHASE',
  'POST_PURCHASE_CARE',
  'SOFT_EXIT',
];
const FLOW_UI_BLOCKS = new Set([
  'VARIANT_PROMPT',
  'ADDRESS_PROMPT',
  'PAYMENT_METHOD_PROMPT',
]);

// پس‌پردازش قطعی quickReplies — بعد از validator، همیشه
export function sanitizeQuickReplies(
  raw: string[],
  opts: { goal: TurnGoal; uiBlockType?: string | null },
): string[] {
  if (NO_QUICK_REPLY_GOALS.includes(opts.goal)) return [];
  if (opts.uiBlockType && FLOW_UI_BLOCKS.has(opts.uiBlockType)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const v = truncateOnWord(r.trim(), QUICK_REPLY_MAX_CHARS);
    const key = normalizeFa(v);
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= QUICK_REPLY_MAX_COUNT) break;
  }
  return out;
}
