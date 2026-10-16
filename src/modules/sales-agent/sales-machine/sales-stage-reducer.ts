// docs/PRD-sales-agent-sales-state-machine.md §۷ — ماشین‌حالت فروش: توابع خالص، بدون I/O و بدون
// Date.now (زمان از ورودی می‌آید). تصمیم «این نوبت چه کار کنیم» اینجا با کد قطعی گرفته می‌شود، نه مدل
import {
  MEMORY_LIMITS,
  type DerivedLeadFunnelStage,
  type ObjectionRecord,
  type ObjectionType,
  type ProductInterest,
  type SalesDecision,
  type SalesMemory,
  type SalesStage,
  type SalesToolName,
  type ServerFacts,
  type TurnGoal,
} from './sales-machine.types';
import { sanitizePerception, type Perception } from './perception.schema';

const has = (p: Perception, act: Perception['primaryAct']): boolean =>
  p.primaryAct === act || p.secondaryActs.includes(act);

function dedupeAppend(prev: string[], add: string[], max: number): string[] {
  const out = [...prev];
  for (const raw of add) {
    const v = raw.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  // سقف: جدیدترین‌ها می‌مانند
  return out.slice(-max);
}

// ───────────────────────────── applyPerception (§۷.۲) ─────────────────────────────

export function applyPerception(
  prev: SalesMemory,
  rawPerception: Perception,
  facts: ServerFacts,
): SalesMemory {
  // idempotent؛ اگر caller قبلاً sanitize کرده باشد تغییری نمی‌کند
  const p = sanitizePerception(
    rawPerception,
    prev.interests.map((i) => i.id),
  );
  const mem: SalesMemory = structuredClone(prev);

  // ۱
  mem.turn = prev.turn + 1;

  // ۲ — ادغام slotUpdates
  const u = p.slotUpdates;
  const s = mem.slots;
  if (u.customerName !== null) s.customerName = u.customerName;
  if (u.goal !== null) s.goal = u.goal;
  if (u.recipient !== null) s.recipient = u.recipient;
  if (u.budgetMaxToman !== null) s.budgetMaxToman = u.budgetMaxToman;
  if (u.budgetMinToman !== null) s.budgetMinToman = u.budgetMinToman;
  if (u.size !== null) s.size = u.size;
  if (u.color !== null) s.color = u.color;
  if (u.deadline !== null) s.deadline = u.deadline;
  if (u.experienceLevel !== null) s.experienceLevel = u.experienceLevel;
  if (u.quantity !== null) s.quantity = u.quantity;
  if (u.province !== null) s.province = u.province;
  s.preferences = dedupeAppend(
    s.preferences,
    u.addPreferences,
    MEMORY_LIMITS.preferences,
  );
  s.dealBreakers = dedupeAppend(
    s.dealBreakers,
    u.addDealBreakers,
    MEMORY_LIMITS.dealBreakers,
  );

  // ۳
  mem.needSummary = p.needSummary ?? prev.needSummary;

  // ۴
  mem.sentimentTrail = [...prev.sentimentTrail, p.sentiment].slice(
    -MEMORY_LIMITS.sentimentTrail,
  );

  // ۵
  mem.irrelevantStreak =
    p.storeRelevance === 'NOT_RELEVANT' && p.primaryAct !== 'GREETING'
      ? prev.irrelevantStreak + 1
      : 0;

  // ۶ — محصولات
  for (const id of p.referencedProductIds) {
    const it = mem.interests.find((i) => i.id === id);
    if (!it) continue;
    if (it.signal !== 'IN_CART') it.signal = 'ASKED';
    it.lastTurn = mem.turn;
  }
  for (const id of p.rejectedProductIds) {
    const it = mem.interests.find((i) => i.id === id);
    if (!it) continue;
    it.signal = 'REJECTED';
    it.note = p.objection?.quote ?? null;
    it.lastTurn = mem.turn;
  }

  // ۷ — اعتراض
  const objection =
    p.objection ??
    (p.primaryAct === 'OBJECTION'
      ? { type: 'OTHER' as ObjectionType, quote: '' }
      : null);
  if (objection) {
    const quote = objection.quote.slice(0, MEMORY_LIMITS.objectionQuoteChars);
    const existing = [...mem.objections]
      .reverse()
      .find(
        (o) =>
          o.type === objection.type &&
          (o.status === 'OPEN' || o.status === 'ADDRESSED'),
      );
    if (existing) {
      existing.status = 'OPEN';
      existing.quote = quote || existing.quote;
      existing.lastTurn = mem.turn;
    } else {
      mem.objections.push({
        type: objection.type,
        quote,
        attempts: 0,
        status: 'OPEN',
        lastTurn: mem.turn,
      });
      if (mem.objections.length > MEMORY_LIMITS.objections) {
        mem.objections = mem.objections.slice(-MEMORY_LIMITS.objections);
      }
    }
  } else {
    // ۸ — حل اعتراض: هیچ اعتراض تازه‌ای نیست و مشتری مثبت/خنثی ادامه داده
    const addressed = [...mem.objections]
      .reverse()
      .find((o) => o.status === 'ADDRESSED');
    if (
      addressed &&
      (p.sentiment === 'POSITIVE' || p.sentiment === 'NEUTRAL') &&
      (
        [
          'ACKNOWLEDGEMENT',
          'BUYING_SIGNAL',
          'PURCHASE_COMMAND',
          'PRODUCT_QUESTION',
        ] as const
      ).includes(p.primaryAct as never)
    ) {
      addressed.status = 'RESOLVED';
    }
  }

  // ۹ — مقدار قبلی را caller قبل از این تابع برای hoursSinceLastMessage خوانده است
  mem.lastCustomerMessageAt = facts.nowIso;
  return mem;
}

// ───────────────────────────── isQualified / resumeStage ─────────────────────────────

export function isQualified(
  mem: SalesMemory,
  p: Perception,
  facts: ServerFacts,
): boolean {
  if (facts.catalogSize === 0) return true; // چیزی برای انتخاب نیست؛ مستقیم سراغ معرفی کسب‌وکار
  if (p.referencedProductIds.length > 0) return true;
  if (mem.discoveryQuestionsAsked >= 2) return true; // سقف بازجویی
  if (facts.catalogSize <= 3 && (mem.needSummary || mem.slots.goal))
    return true;
  const hasNeed = !!(mem.needSummary || mem.slots.goal);
  const narrowing =
    [
      mem.slots.budgetMaxToman,
      mem.slots.recipient,
      mem.slots.size,
      mem.slots.experienceLevel,
      mem.slots.color,
    ].filter((v) => v !== null).length + mem.slots.preferences.length;
  return hasNeed && narrowing >= 1;
}

export function resumeStage(mem: SalesMemory, facts: ServerFacts): SalesStage {
  if (facts.cartItemCount > 0) return 'CHECKOUT';
  const recentInterest = mem.interests.some(
    (i) => i.signal !== 'REJECTED' && mem.turn - i.lastTurn <= 5,
  );
  if (recentInterest) return 'EVALUATION';
  if (mem.needSummary) return 'DISCOVERY';
  return 'OPENING';
}

// ───────────────────────────── ابزارهای مجاز (§۷.۴) ─────────────────────────────

const READ: SalesToolName[] = [
  'search_products',
  'get_product_details',
  'answer_faq',
  'show_product_photos',
  'compare_products',
];

export const TOOLS_BY_GOAL: Record<TurnGoal, SalesToolName[]> = {
  GREET_AND_OPEN: ['answer_faq', 'respond_to_customer'],
  DISCOVER_NEED: ['answer_faq', 'respond_to_customer'],
  RECOMMEND: [...READ, 'respond_to_customer'],
  ANSWER_AND_ADVANCE: [
    ...READ,
    'view_cart',
    'check_order_status',
    'request_human_handoff',
    'respond_to_customer',
  ],
  HANDLE_OBJECTION: [
    ...READ,
    'apply_discount',
    'request_human_handoff',
    'respond_to_customer',
  ],
  TRIAL_CLOSE: [...READ, 'respond_to_customer'],
  ALTERNATIVE_CLOSE: [...READ, 'update_cart', 'respond_to_customer'],
  EXECUTE_PURCHASE: [
    'get_product_details',
    'search_products',
    'update_cart',
    'view_cart',
    'apply_discount',
    'create_order',
    'respond_to_customer',
  ],
  ASSIST_CHECKOUT: [
    'view_cart',
    'update_cart',
    'apply_discount',
    'create_order',
    'cancel_order',
    'answer_faq',
    'check_order_status',
    'respond_to_customer',
  ],
  POST_PURCHASE_CARE: [
    'check_order_status',
    'answer_faq',
    'request_human_handoff',
    'respond_to_customer',
  ],
  HONEST_NOT_A_FIT: [
    'search_products',
    'answer_faq',
    'request_human_handoff',
    'respond_to_customer',
  ],
  SOFT_EXIT: ['request_human_handoff', 'respond_to_customer'],
};

const LEAD_ONLY_REMOVED: SalesToolName[] = [
  'update_cart',
  'view_cart',
  'apply_discount',
  'cancel_order',
];

// `base` فقط برای قانون R3 (SUPPORT_ISSUE/ORDER_STATUS) که لیست مخصوص خودش را دارد
export function resolveAllowedTools(
  goal: TurnGoal,
  facts: Pick<ServerFacts, 'leadCaptureOnly'>,
  base?: SalesToolName[],
): SalesToolName[] {
  const list = base ?? TOOLS_BY_GOAL[goal];
  if (!facts.leadCaptureOnly) return [...list];
  // docs/PRD-nivo-lead-shop-seller-signup.md §5.2 (P6) — فقط در فروشگاه لید، گُل‌های بستن هم ابزار capture_lead
  // را دارند (فروشگاه عادی همان TOOLS_BY_GOAL بدون create_order می‌ماند)
  const withClose =
    !base && (goal === 'ALTERNATIVE_CLOSE' || goal === 'TRIAL_CLOSE') ? [...list, 'create_order' as SalesToolName] : list;
  const mapped = withClose
    .filter((t) => !LEAD_ONLY_REMOVED.includes(t))
    .map((t): SalesToolName => (t === 'create_order' ? 'capture_lead' : t));
  return [...new Set(mapped)];
}

// ───────────────────────────── decideSalesTurn (§۷.۳) ─────────────────────────────

const WELCOME_BACK_HOURS = 20;

function findFocusObjection(
  mem: SalesMemory,
  type: ObjectionType,
  quoteFallback: string,
): ObjectionRecord {
  const rec = [...mem.objections]
    .reverse()
    .find(
      (o) =>
        o.type === type && (o.status === 'OPEN' || o.status === 'ADDRESSED'),
    );
  return (
    rec ?? {
      type,
      quote: quoteFallback.slice(0, MEMORY_LIMITS.objectionQuoteChars),
      attempts: 0,
      status: 'OPEN',
      lastTurn: mem.turn,
    }
  );
}

export function decideSalesTurn(
  mem: SalesMemory, // خروجی applyPerception
  prevStage: SalesStage, // mem قبل از applyPerception
  p: Perception,
  facts: ServerFacts,
  hoursSinceLastMessage: number | null,
): SalesDecision {
  const act = p.primaryAct;
  const welcomeBack =
    hoursSinceLastMessage !== null &&
    hoursSinceLastMessage >= WELCOME_BACK_HOURS;

  const make = (
    stage: SalesStage,
    goal: TurnGoal,
    reason: string,
    extra: Partial<
      Pick<SalesDecision, 'focusObjection' | 'shortCircuit' | 'allowedTools'>
    > = {},
  ): SalesDecision => ({
    stage,
    goal,
    reason,
    focusObjection: extra.focusObjection ?? null,
    welcomeBack,
    shortCircuit: extra.shortCircuit ?? null,
    allowedTools:
      extra.allowedTools ??
      (extra.shortCircuit ? [] : resolveAllowedTools(goal, facts)),
  });

  const cs = facts.conversationState;

  // R0 — بعد از خرید. (انحراف ثبت‌شده: درخواست انسان/اسپم هم از این قانون عبور می‌کنند)
  if (
    cs === 'COMPLETED' &&
    act !== 'NEED_STATEMENT' &&
    act !== 'PURCHASE_COMMAND' &&
    act !== 'HUMAN_REQUEST' &&
    act !== 'SPAM'
  ) {
    return make('POST_PURCHASE', 'POST_PURCHASE_CARE', 'R0_COMPLETED');
  }

  // R1 — حین پرداخت. (انحراف ثبت‌شده: درخواست انسان از این قانون عبور می‌کند)
  if (
    (cs === 'AWAITING_PAYMENT' ||
      cs === 'RECEIPT_SUBMITTED' ||
      cs === 'AWAITING_SELLER_APPROVAL') &&
    act !== 'HUMAN_REQUEST' &&
    act !== 'SPAM'
  ) {
    if (p.objection) {
      return make('CHECKOUT', 'HANDLE_OBJECTION', 'R1_PAYMENT_OBJECTION', {
        focusObjection: findFocusObjection(
          mem,
          p.objection.type,
          p.objection.quote,
        ),
      });
    }
    return make('CHECKOUT', 'ASSIST_CHECKOUT', 'R1_AWAITING_PAYMENT');
  }

  // R2
  if (act === 'HUMAN_REQUEST') {
    return make(prevStage, 'ANSWER_AND_ADVANCE', 'R2_HUMAN_REQUEST', {
      shortCircuit: 'HUMAN_HANDOFF',
    });
  }

  // R3 — ابزارها فقط وضعیت سفارش و ارجاع
  if (act === 'SUPPORT_ISSUE' || act === 'ORDER_STATUS') {
    return make(prevStage, 'ANSWER_AND_ADVANCE', 'R3_SUPPORT_OR_ORDER_STATUS', {
      allowedTools: resolveAllowedTools('ANSWER_AND_ADVANCE', facts, [
        'check_order_status',
        'request_human_handoff',
        'respond_to_customer',
      ]),
    });
  }

  // R4
  if (act === 'SPAM') {
    return make(prevStage, 'ANSWER_AND_ADVANCE', 'R4_SPAM', {
      shortCircuit: 'SPAM_REPLY',
    });
  }

  // R5
  if (act === 'PURCHASE_COMMAND') {
    const checkout = facts.cartItemCount > 0 && has(p, 'CART_ACTION');
    return make(
      checkout ? 'CHECKOUT' : 'CLOSING',
      'EXECUTE_PURCHASE',
      'R5_PURCHASE_COMMAND',
    );
  }

  // R6 / R6b
  if (p.objection !== null || act === 'OBJECTION') {
    const type = p.objection?.type ?? 'OTHER';
    const focus = findFocusObjection(mem, type, p.objection?.quote ?? '');
    if (focus.attempts >= 2) {
      return make('DORMANT', 'SOFT_EXIT', `R6b_OBJECTION_${type}_EXHAUSTED`, {
        focusObjection: focus,
      });
    }
    return make('OBJECTION', 'HANDLE_OBJECTION', `R6_OBJECTION_${type}`, {
      focusObjection: focus,
    });
  }

  // R7
  if (act === 'DISENGAGE') {
    return make('DORMANT', 'SOFT_EXIT', 'R7_DISENGAGE');
  }

  // R8
  if (act === 'IDENTITY_QUESTION') {
    return make(prevStage, 'ANSWER_AND_ADVANCE', 'R8_IDENTITY');
  }

  // R9
  if (
    mem.irrelevantStreak >= 2 ||
    (p.storeRelevance === 'NOT_RELEVANT' && p.painSolvable === 'NO')
  ) {
    return make('NOT_A_FIT', 'HONEST_NOT_A_FIT', 'R9_NOT_A_FIT');
  }

  // R10
  if (p.buyingSignal === 'STRONG') {
    return make('CLOSING', 'ALTERNATIVE_CLOSE', 'R10_STRONG_SIGNAL');
  }

  // R11 — «آره» به پیشنهاد خرید = خرید (شبکه‌ی ایمنی برای ادراک)
  if (
    act === 'ACKNOWLEDGEMENT' &&
    (mem.lastGoal === 'TRIAL_CLOSE' || mem.lastGoal === 'ALTERNATIVE_CLOSE') &&
    mem.lastCloseOffer
  ) {
    return make('CLOSING', 'EXECUTE_PURCHASE', 'R11_ACK_CLOSE_OFFER');
  }

  // R12
  if (act === 'ACKNOWLEDGEMENT' && mem.lastGoal === 'RECOMMEND') {
    return make('CLOSING', 'ALTERNATIVE_CLOSE', 'R12_ACK_RECOMMENDATION');
  }

  // R13
  if (
    facts.cartItemCount > 0 &&
    (act === 'ACKNOWLEDGEMENT' ||
      act === 'BUYING_SIGNAL' ||
      act === 'CART_ACTION' ||
      act === 'SMALL_TALK')
  ) {
    return make('CHECKOUT', 'ASSIST_CHECKOUT', 'R13_CART_NOT_EMPTY');
  }

  // R14
  if (act === 'POLICY_QUESTION') {
    const stage =
      prevStage === 'OPENING'
        ? 'DISCOVERY'
        : prevStage === 'DORMANT'
          ? resumeStage(mem, facts)
          : prevStage;
    return make(stage, 'ANSWER_AND_ADVANCE', 'R14_POLICY_QUESTION');
  }

  // R15
  if (
    (act === 'PRODUCT_QUESTION' || act === 'COMPARISON') &&
    (p.referencedProductIds.length > 0 ||
      mem.interests.some((i) => i.signal !== 'REJECTED'))
  ) {
    if (
      prevStage === 'EVALUATION' &&
      mem.turn - mem.stageEnteredTurn >= 2 &&
      p.engagement !== 'LOW' &&
      p.buyingSignal !== 'NONE'
    ) {
      return make('EVALUATION', 'TRIAL_CLOSE', 'R15a_EVALUATION_TRIAL_CLOSE');
    }
    return make('EVALUATION', 'ANSWER_AND_ADVANCE', 'R15b_PRODUCT_QUESTION');
  }

  // R16
  if (
    p.buyingSignal === 'WEAK' &&
    (prevStage === 'RECOMMENDATION' ||
      prevStage === 'EVALUATION' ||
      prevStage === 'OBJECTION')
  ) {
    return make('CLOSING', 'TRIAL_CLOSE', 'R16_WEAK_SIGNAL');
  }

  // R17
  if (
    prevStage === 'OBJECTION' &&
    (act === 'ACKNOWLEDGEMENT' || act === 'SMALL_TALK')
  ) {
    return make('CLOSING', 'TRIAL_CLOSE', 'R17_OBJECTION_ACCEPTED');
  }

  // R18
  if (
    act === 'NEED_STATEMENT' ||
    (act === 'OFF_TOPIC' && p.storeRelevance !== 'NOT_RELEVANT') ||
    (act === 'ACKNOWLEDGEMENT' && mem.lastGoal === 'DISCOVER_NEED')
  ) {
    return isQualified(mem, p, facts)
      ? make('RECOMMENDATION', 'RECOMMEND', 'R18_QUALIFIED')
      : make('DISCOVERY', 'DISCOVER_NEED', 'R18_NEEDS_DISCOVERY');
  }

  // R19 — (انحراف ثبت‌شده: welcomeBack از هر مرحله‌ای، مثلاً CHECKOUT با سبد پر، سلام را «خوش‌برگشتی» می‌کند)
  if (
    act === 'GREETING' &&
    (welcomeBack ||
      ((prevStage === 'OPENING' || prevStage === 'DORMANT') && mem.turn <= 1))
  ) {
    return facts.cartItemCount > 0
      ? make('CHECKOUT', 'ASSIST_CHECKOUT', 'R19_GREETING_WITH_CART')
      : make('OPENING', 'GREET_AND_OPEN', 'R19_GREETING');
  }

  // R20
  if (act === 'OFF_TOPIC') {
    return make('NOT_A_FIT', 'HONEST_NOT_A_FIT', 'R20_OFF_TOPIC');
  }

  // R21 — پیش‌فرض
  return make(
    prevStage === 'DORMANT' ? resumeStage(mem, facts) : prevStage,
    'ANSWER_AND_ADVANCE',
    'R21_DEFAULT',
  );
}

// ───────────────────────────── recordAgentTurn (§۷.۵) ─────────────────────────────

export type AgentTurnOutput = {
  text: string;
  askedQuestion: string | null;
  quickReplies: string[];
  shownProducts: { id: string; name: string; priceToman: number }[];
  cartProductIds: string[];
  comparedProductIds: string[];
};

function capInterests(interests: ProductInterest[]): ProductInterest[] {
  const out = [...interests];
  while (out.length > MEMORY_LIMITS.interests) {
    const idx = out.findIndex((i) => i.signal !== 'IN_CART');
    out.splice(idx === -1 ? 0 : idx, 1);
  }
  return out;
}

export function recordAgentTurn(
  prev: SalesMemory,
  decision: SalesDecision,
  out: AgentTurnOutput,
): SalesMemory {
  const mem: SalesMemory = structuredClone(prev);

  // ۱
  if (decision.stage !== mem.stage) mem.stageEnteredTurn = mem.turn;
  mem.stage = decision.stage;

  // ۲
  mem.lastGoal = decision.goal;

  // ۳ / ۴
  if (decision.goal === 'DISCOVER_NEED' && out.askedQuestion) {
    mem.discoveryQuestionsAsked += 1;
  }
  if (out.askedQuestion) {
    mem.askedQuestions = [
      ...mem.askedQuestions,
      { text: out.askedQuestion, turn: mem.turn },
    ].slice(-MEMORY_LIMITS.askedQuestions);
    mem.lastAgentQuestion = out.askedQuestion;
  } else {
    mem.lastAgentQuestion = null;
  }

  // ۵ — اعتراض
  if (decision.goal === 'SOFT_EXIT') {
    for (const o of mem.objections) {
      if (o.status === 'OPEN') o.status = 'UNRESOLVED';
    }
  } else if (decision.focusObjection) {
    const type = decision.focusObjection.type;
    const rec = [...mem.objections].reverse().find((o) => o.type === type);
    if (rec) {
      rec.attempts += 1;
      rec.status = 'ADDRESSED';
    }
  }

  // ۶ — محصولات
  for (const sp of out.shownProducts) {
    const it = mem.interests.find((i) => i.id === sp.id);
    if (it) {
      if (sp.priceToman > 0) it.priceToman = sp.priceToman;
      it.lastTurn = mem.turn;
    } else {
      mem.interests.push({
        id: sp.id,
        name: sp.name,
        priceToman: sp.priceToman,
        signal: 'SHOWN',
        note: null,
        lastTurn: mem.turn,
      });
    }
  }
  for (const id of out.comparedProductIds) {
    const it = mem.interests.find((i) => i.id === id);
    if (it && it.signal !== 'IN_CART') {
      it.signal = 'COMPARED';
      it.lastTurn = mem.turn;
    }
  }
  for (const id of out.cartProductIds) {
    const it = mem.interests.find((i) => i.id === id);
    if (it) {
      it.signal = 'IN_CART';
      it.lastTurn = mem.turn;
    }
  }
  mem.interests = capInterests(mem.interests);

  // ۷ — lastCloseOffer
  if (decision.goal === 'EXECUTE_PURCHASE') {
    mem.lastCloseOffer = null;
  } else if (
    (decision.goal === 'TRIAL_CLOSE' ||
      decision.goal === 'ALTERNATIVE_CLOSE' ||
      decision.goal === 'RECOMMEND') &&
    (out.quickReplies.length > 0 || out.shownProducts.length > 0)
  ) {
    const asked = [...mem.interests]
      .reverse()
      .find((i) => i.signal === 'ASKED' || i.signal === 'SHOWN');
    mem.lastCloseOffer = {
      productIds: out.shownProducts.length
        ? out.shownProducts.map((p) => p.id)
        : asked
          ? [asked.id]
          : [],
      options: out.quickReplies,
      turn: mem.turn,
    };
  }

  // ۸
  mem.lastQuickReplies = out.quickReplies;
  return mem;
}

// ───────────────────────────── فانل لید (§۱۳) ─────────────────────────────

// null = «بدون تغییر» (DORMANT, POST_PURCHASE)
export function deriveLeadFunnelStage(
  stage: SalesStage,
): DerivedLeadFunnelStage | null {
  switch (stage) {
    case 'OPENING':
      return 'NEW';
    case 'DISCOVERY':
      return 'DISCOVERING_NEED';
    case 'RECOMMENDATION':
    case 'EVALUATION':
      return 'PITCHED';
    case 'OBJECTION':
      return 'OBJECTION_RAISED';
    case 'CLOSING':
    case 'CHECKOUT':
      return 'READY_TO_CAPTURE';
    case 'NOT_A_FIT':
      return 'NOT_RELEVANT';
    default:
      return null;
  }
}
