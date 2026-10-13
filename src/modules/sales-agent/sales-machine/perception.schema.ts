// docs/PRD-sales-agent-sales-state-machine.md §۶ — لایه‌ی ادراک: یک فراخوان کوچک LLM که فقط
// «فهمیدن پیام» را انجام می‌دهد؛ هیچ تصمیم فروشی نمی‌گیرد (تصمیم = sales-stage-reducer.ts)
import { z } from 'zod';
import { BUYER_NEED_TAGS } from '../intent-classification.schema';
import {
  MEMORY_LIMITS,
  OBJECTION_TYPES,
  type SalesMemory,
  type SalesSlots,
  type SalesStage,
  type TurnGoal,
} from './sales-machine.types';

export const MESSAGE_ACTS = [
  'GREETING',
  'NEED_STATEMENT',
  'PRODUCT_QUESTION',
  'POLICY_QUESTION',
  'COMPARISON',
  'OBJECTION',
  'BUYING_SIGNAL',
  'PURCHASE_COMMAND',
  'CART_ACTION',
  'ACKNOWLEDGEMENT',
  'ORDER_STATUS',
  'SUPPORT_ISSUE',
  'HUMAN_REQUEST',
  'IDENTITY_QUESTION',
  'SMALL_TALK',
  'DISENGAGE',
  'OFF_TOPIC',
  'SPAM',
] as const;
export type MessageAct = (typeof MESSAGE_ACTS)[number];

export const perceptionSchema = z.object({
  primaryAct: z.enum(MESSAGE_ACTS),
  secondaryActs: z.array(z.enum(MESSAGE_ACTS)).max(2),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'FRUSTRATED']),
  engagement: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  buyingSignal: z.enum(['NONE', 'WEAK', 'STRONG']),
  objection: z
    .object({
      type: z.enum(OBJECTION_TYPES),
      quote: z.string(),
    })
    .nullable(),
  // اطلاعات تازه‌ای که *همین پیام* داد؛ فیلدی که تغییری نکرده null
  slotUpdates: z.object({
    customerName: z.string().nullable(),
    goal: z.string().nullable(),
    recipient: z.string().nullable(),
    budgetMaxToman: z.number().int().nullable(),
    budgetMinToman: z.number().int().nullable(),
    size: z.string().nullable(),
    color: z.string().nullable(),
    addPreferences: z.array(z.string()).max(3),
    addDealBreakers: z.array(z.string()).max(2),
    deadline: z.string().nullable(),
    experienceLevel: z.string().nullable(),
    quantity: z.number().int().positive().nullable(),
    province: z.string().nullable(),
  }),
  // فقط شناسه‌هایی از لیست «محصولات مطرح‌شده»؛ هرگز شناسه‌ی ساختگی
  referencedProductIds: z.array(z.string()).max(3),
  rejectedProductIds: z.array(z.string()).max(3),
  answeredLastQuestion: z.boolean(),
  needSummary: z.string().nullable(),
  storeRelevance: z.enum(['RELEVANT', 'POSSIBLY_RELEVANT', 'NOT_RELEVANT']),
  painSolvable: z.enum(['UNKNOWN', 'YES', 'PARTIAL', 'NO']),
  // بازگرداندن آنالیتیکس از دست‌رفته (§۱ ردیف ۱۱)
  buyerNeeds: z.array(z.enum(BUYER_NEED_TAGS)).max(4),
});
export type Perception = z.infer<typeof perceptionSchema>;

const BILLION_10 = 10_000_000_000;

// پس‌پردازش قطعی بعد از دریافت (اعتماد کور نیست). idempotent است: دوبار اجرا همان نتیجه را می‌دهد
export function sanitizePerception(
  p: Perception,
  knownProductIds: Iterable<string>,
): Perception {
  const known = new Set(knownProductIds);
  const fixBudget = (v: number | null): number | null => {
    if (v === null) return null;
    if (v <= 0) return null;
    if (v > BILLION_10) return null;
    // «۵۰۰» در محاوره = ۵۰۰ هزار تومان (هزار تومان حذف شده)
    return v < 1000 ? v * 1000 : v;
  };
  const dedupe = (arr: string[], max: number): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of arr) {
      const v = raw.trim();
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= max) break;
    }
    return out;
  };
  return {
    ...p,
    objection: p.objection
      ? {
          type: p.objection.type,
          quote: p.objection.quote.slice(0, MEMORY_LIMITS.objectionQuoteChars),
        }
      : null,
    slotUpdates: {
      ...p.slotUpdates,
      budgetMaxToman: fixBudget(p.slotUpdates.budgetMaxToman),
      budgetMinToman: fixBudget(p.slotUpdates.budgetMinToman),
      addPreferences: dedupe(
        p.slotUpdates.addPreferences,
        MEMORY_LIMITS.preferences,
      ),
      addDealBreakers: dedupe(
        p.slotUpdates.addDealBreakers,
        MEMORY_LIMITS.dealBreakers,
      ),
    },
    referencedProductIds: p.referencedProductIds.filter((id) => known.has(id)),
    rejectedProductIds: p.rejectedProductIds.filter((id) => known.has(id)),
  };
}

// §۶.۳ — اگر همه‌ی مدل‌ها شکست خوردند؛ نوبت هرگز به‌خاطر ادراک متوقف نمی‌شود
export function neutralPerception(
  mem: Pick<SalesMemory, 'interests'>,
): Perception {
  return {
    primaryAct:
      mem.interests.length > 0 ? 'PRODUCT_QUESTION' : 'NEED_STATEMENT',
    secondaryActs: [],
    sentiment: 'NEUTRAL',
    engagement: 'MEDIUM',
    buyingSignal: 'NONE',
    objection: null,
    slotUpdates: {
      customerName: null,
      goal: null,
      recipient: null,
      budgetMaxToman: null,
      budgetMinToman: null,
      size: null,
      color: null,
      addPreferences: [],
      addDealBreakers: [],
      deadline: null,
      experienceLevel: null,
      quantity: null,
      province: null,
    },
    referencedProductIds: [],
    rejectedProductIds: [],
    answeredLastQuestion: false,
    needSummary: null,
    storeRelevance: 'POSSIBLY_RELEVANT',
    painSolvable: 'UNKNOWN',
    buyerNeeds: [],
  };
}

export type PerceptionInput = {
  storeContextSummary: string; // category + brandIntro کوتاه‌شده (۳۰۰ کاراکتر)
  stage: SalesStage;
  lastGoal: TurnGoal | null;
  lastAgentMessage: string | null;
  lastAgentQuestion: string | null;
  lastCloseOffer: SalesMemory['lastCloseOffer'];
  knownSlots: SalesSlots;
  mentionedProducts: { id: string; name: string; priceToman: number }[];
  cartSummary: string; // «خالی» یا «X × 1، Y × 2»
  recentTranscript: string; // ۶ پیام آخر، «مشتری:»/«فروشنده:»
};

const SLOT_KEYS_FA: Record<keyof SalesSlots, string> = {
  customerName: 'اسم',
  goal: 'هدف',
  recipient: 'برای',
  budgetMaxToman: 'سقف بودجه (تومان)',
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

export function describeKnownSlots(slots: SalesSlots): string {
  const parts: string[] = [];
  for (const key of Object.keys(SLOT_KEYS_FA) as (keyof SalesSlots)[]) {
    const v = slots[key];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      parts.push(`${SLOT_KEYS_FA[key]}: ${v.join('، ')}`);
    } else {
      parts.push(`${SLOT_KEYS_FA[key]}: ${String(v)}`);
    }
  }
  return parts.length ? parts.join(' | ') : 'هیچ';
}

// §۶.۲ — system prompt ادراک؛ prompt (user) خودِ متن خام پیام مشتری است
export function buildPerceptionPrompt(input: PerceptionInput): string {
  const products = input.mentionedProducts.length
    ? input.mentionedProducts
        .map(
          (p) =>
            `${p.id} — ${p.name}${p.priceToman > 0 ? ` — ${p.priceToman} تومان` : ''}`,
        )
        .join('\n')
    : 'هیچ';
  const closeOffer = input.lastCloseOffer
    ? `فروشنده در نوبت قبل این گزینه‌ها را برای خرید پیشنهاد داد: ${
        input.lastCloseOffer.options.length
          ? input.lastCloseOffer.options.join(' / ')
          : input.lastCloseOffer.productIds.join('، ')
      }\n`
    : '';
  return `تو فقط «تحلیل‌گر پیام» یک فروشگاه در دایرکت هستی، نه فروشنده — هیچ جوابی برای مشتری نمی‌نویسی.
کارت این است که آخرین پیام مشتری را در بافت گفتگو بفهمی و فقط JSON مطابق schema برگردانی.

زمینه‌ی فروشگاه: ${input.storeContextSummary || 'نامشخص'}
مرحله‌ی فعلی فروش: ${input.stage} | هدف نوبت قبلی فروشنده: ${input.lastGoal ?? 'ندارد'}
آخرین پیام فروشنده: «${input.lastAgentMessage ?? '—'}»
آخرین سؤالی که فروشنده پرسید: «${input.lastAgentQuestion ?? '—'}»
${closeOffer}اطلاعاتی که از قبل درباره‌ی مشتری می‌دانیم: ${describeKnownSlots(input.knownSlots)}
محصولاتی که در این گفتگو مطرح شده‌اند (شناسه — نام — قیمت):
${products}
سبد: ${input.cartSummary}

تاریخچه‌ی اخیر:
${input.recentTranscript || '—'}

قواعد مهم:
۱. پیام‌های کوتاه («آره»، «باشه»، «اوکی»، «همون»، «اولی») را همیشه نسبت به آخرین سؤال/پیشنهاد فروشنده
   تفسیر کن. اگر فروشنده پیشنهاد خرید/گزینه داده بود و مشتری تایید کرد → primaryAct=PURCHASE_COMMAND
   (نه ACKNOWLEDGEMENT)، و referencedProductIds را با همان محصول پر کن. اگر فروشنده سؤال کشف پرسیده بود
   و مشتری جواب داد → answeredLastQuestion=true و slotUpdates را پر کن.
۲. «گرونه»، «تخفیف نداره؟»، «ارزون‌ترش نیست؟» → OBJECTION با type=PRICE (حتی اگر سؤالی باشد).
   «بعداً»، «فعلاً پول ندارم ولی می‌خوامش» → OBJECTION/TIMING. «مرسی فعلاً نه» بدون دلیل → DISENGAGE.
۳. سؤال «کی میرسه؟»، «رنگ دیگه‌ش هست؟»، «سایز L داری؟» بعد از اینکه مشتری محصولی را پسندیده → BUYING_SIGNAL
   (secondaryActs می‌تواند PRODUCT_QUESTION باشد). buyingSignal: STRONG وقتی واضحاً دارد جزئیات
   خرید را نهایی می‌کند؛ WEAK وقتی فقط علاقه‌ی مثبت است («قشنگه»، «خوبه»).
۴. budget را به تومان کامل برگردان («۵۰۰ تومن» در محاوره معمولاً یعنی ۵۰۰ هزار تومان → 500000؛
   «یه تومن» یعنی یک میلیون → 1000000).
۵. slotUpdates فقط اطلاعات *تازه‌ی همین پیام* را دارد؛ چیزی را که از قبل می‌دانیم تکرار نکن، و هیچ
   چیزی را حدس نزن.
۶. referencedProductIds/rejectedProductIds فقط از شناسه‌های لیست بالا — اگر مطمئن نیستی خالی بگذار.
۷. یک هدف/سؤال شخصیِ واقعی که به این فروشگاه ربطی ندارد OFF_TOPIC است، هرگز SPAM؛ SPAM فقط تبلیغ/لینک
   مشکوک/پیام بی‌معنای انبوه است.
۸. needSummary: یک خط فارسی از نیاز واقعی کل گفتگو تا الان (نه فقط این پیام)، یا null اگر هنوز نیازی معلوم نیست.`;
}
