// docs/PRD-sales-agent-sales-state-machine.md §۵.۴ — مقداردهی و مهاجرت حافظه‌ی فروش
import type { ConversationContext, CustomerState } from '../sales-agent.types';
import type {
  SalesMemory,
  SalesSlots,
  SalesStage,
} from './sales-machine.types';

export function emptySlots(): SalesSlots {
  return {
    customerName: null,
    goal: null,
    recipient: null,
    budgetMaxToman: null,
    budgetMinToman: null,
    size: null,
    color: null,
    preferences: [],
    dealBreakers: [],
    deadline: null,
    experienceLevel: null,
    quantity: null,
    province: null,
  };
}

const STAGE_FROM_LEGACY: Record<CustomerState['stage'], SalesStage> = {
  DISCOVERY: 'DISCOVERY',
  PAIN_IDENTIFIED: 'DISCOVERY',
  PITCHED: 'EVALUATION',
  OBJECTION: 'OBJECTION',
  READY: 'CLOSING',
  STALLED: 'EVALUATION',
  LOST: 'DORMANT',
};

export function loadSalesMemory(ctx: ConversationContext): SalesMemory {
  if (ctx.sales?.version === 1) return structuredClone(ctx.sales);
  // مهاجرت از مکالمه‌ی قدیمی FULL_AGENT (priceToman: 0 یعنی «نامعلوم»)
  const legacy = ctx.customerState;
  return {
    version: 1,
    stage: legacy
      ? STAGE_FROM_LEGACY[legacy.stage]
      : ctx.cart.length
        ? 'CHECKOUT'
        : 'OPENING',
    stageEnteredTurn: 0,
    turn: 0,
    lastGoal: null,
    slots: emptySlots(),
    needSummary: legacy?.pain ?? null,
    objections: [],
    interests: (ctx.lastShownProducts ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      priceToman: 0,
      signal: 'SHOWN' as const,
      note: null,
      lastTurn: 0,
    })),
    askedQuestions: [],
    discoveryQuestionsAsked: 0,
    lastAgentQuestion: null,
    lastCloseOffer: null,
    lastQuickReplies: [],
    sentimentTrail: [],
    irrelevantStreak: 0,
    lastCustomerMessageAt: null,
  };
}

// «خالی» یا «X × 1، Y × 2»
export function summarizeCart(
  cart: { name: string; qty: number; variantLabel?: string }[],
): string {
  if (cart.length === 0) return 'خالی';
  return cart
    .map(
      (i) =>
        `${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.qty}`,
    )
    .join('، ');
}

export function hoursBetween(
  prevIso: string | null,
  nowIso: string,
): number | null {
  if (!prevIso) return null;
  const prev = Date.parse(prevIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(prev) || Number.isNaN(now)) return null;
  return (now - prev) / 3_600_000;
}
