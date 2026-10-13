import { sanitizePerception } from './perception.schema';
import {
  applyPerception,
  decideSalesTurn,
  deriveLeadFunnelStage,
  recordAgentTurn,
  resolveAllowedTools,
  type AgentTurnOutput,
} from './sales-stage-reducer';
import { hoursBetween } from './sales-memory.util';
import {
  SALES_STAGES,
  type ProductInterest,
  type SalesDecision,
  type SalesMemory,
  type ServerFacts,
} from './sales-machine.types';
import type { Perception } from './perception.schema';
import { facts, memory, perception } from './sales-machine.test-utils';

// یک نوبت کامل: sanitize → apply → decide
function turn(
  prev: SalesMemory,
  raw: Perception,
  f: ServerFacts = facts(),
): { mem: SalesMemory; decision: SalesDecision; p: Perception } {
  const p = sanitizePerception(
    raw,
    prev.interests.map((i) => i.id),
  );
  const hours = hoursBetween(prev.lastCustomerMessageAt, f.nowIso);
  const mem = applyPerception(prev, p, f);
  const decision = decideSalesTurn(mem, prev.stage, p, f, hours);
  return { mem, decision, p };
}

const noOut: AgentTurnOutput = {
  text: '',
  askedQuestion: null,
  quickReplies: [],
  shownProducts: [],
  cartProductIds: [],
  comparedProductIds: [],
};

describe('sales-stage-reducer', () => {
  it('1. اولین پیام «سلام» → OPENING / GREET_AND_OPEN', () => {
    const { decision } = turn(memory(), perception({ primaryAct: 'GREETING' }));
    expect(decision.stage).toBe('OPENING');
    expect(decision.goal).toBe('GREET_AND_OPEN');
  });

  it('2. نیاز مبهم در کاتالوگ بزرگ بدون slot دیگر → DISCOVERY / DISCOVER_NEED', () => {
    const { decision } = turn(
      memory(),
      perception({ primaryAct: 'NEED_STATEMENT', needSummary: 'هدیه' }),
    );
    expect(decision.stage).toBe('DISCOVERY');
    expect(decision.goal).toBe('DISCOVER_NEED');
  });

  it('3. با بودجه → RECOMMENDATION / RECOMMEND و slot ذخیره می‌شود', () => {
    const prev = memory({
      stage: 'DISCOVERY',
      turn: 1,
      needSummary: 'هدیه برای خواهر',
      lastGoal: 'DISCOVER_NEED',
    });
    const raw = perception({ primaryAct: 'NEED_STATEMENT' });
    raw.slotUpdates.budgetMaxToman = 800000;
    const { decision, mem } = turn(prev, raw);
    expect(decision.stage).toBe('RECOMMENDATION');
    expect(decision.goal).toBe('RECOMMEND');
    expect(mem.slots.budgetMaxToman).toBe(800000);
  });

  it('3b. بودجه‌ی «۸۰۰» به ۸۰۰ هزار تومان تصحیح می‌شود', () => {
    const raw = perception();
    raw.slotUpdates.budgetMaxToman = 800;
    expect(sanitizePerception(raw, []).slotUpdates.budgetMaxToman).toBe(800000);
  });

  it('4. سقف بازجویی: دو سؤال کشف پرسیده شده → RECOMMEND', () => {
    const prev = memory({
      stage: 'DISCOVERY',
      turn: 2,
      discoveryQuestionsAsked: 2,
      lastGoal: 'DISCOVER_NEED',
    });
    const { decision } = turn(
      prev,
      perception({ primaryAct: 'NEED_STATEMENT' }),
    );
    expect(decision.goal).toBe('RECOMMEND');
  });

  it('5. کاتالوگ ۲ محصولی + نیاز → RECOMMEND بدون سؤال کشف', () => {
    const { decision } = turn(
      memory(),
      perception({ primaryAct: 'NEED_STATEMENT', needSummary: 'شال نخی' }),
      facts({ catalogSize: 2 }),
    );
    expect(decision.goal).toBe('RECOMMEND');
  });

  it('6. بعد از RECOMMEND، ACKNOWLEDGEMENT → CLOSING / ALTERNATIVE_CLOSE (R12)', () => {
    const prev = memory({
      stage: 'RECOMMENDATION',
      turn: 3,
      lastGoal: 'RECOMMEND',
    });
    const { decision } = turn(
      prev,
      perception({ primaryAct: 'ACKNOWLEDGEMENT' }),
    );
    expect(decision.stage).toBe('CLOSING');
    expect(decision.goal).toBe('ALTERNATIVE_CLOSE');
    expect(decision.reason).toContain('R12');
  });

  it('7. بعد از ALTERNATIVE_CLOSE، ACKNOWLEDGEMENT → EXECUTE_PURCHASE (R11)', () => {
    const prev = memory({
      stage: 'CLOSING',
      turn: 4,
      lastGoal: 'ALTERNATIVE_CLOSE',
      lastCloseOffer: {
        productIds: ['p1'],
        options: ['مشکی', 'سرمه‌ای'],
        turn: 4,
      },
    });
    const { decision } = turn(
      prev,
      perception({ primaryAct: 'ACKNOWLEDGEMENT' }),
    );
    expect(decision.goal).toBe('EXECUTE_PURCHASE');
    expect(decision.reason).toContain('R11');
  });

  it('8. «گرونه» → OBJECTION / HANDLE_OBJECTION با PRICE و attempts=0', () => {
    const prev = memory({
      stage: 'RECOMMENDATION',
      turn: 3,
      lastGoal: 'RECOMMEND',
    });
    const { decision } = turn(
      prev,
      perception({
        primaryAct: 'OBJECTION',
        objection: { type: 'PRICE', quote: 'گرونه' },
      }),
    );
    expect(decision.stage).toBe('OBJECTION');
    expect(decision.goal).toBe('HANDLE_OBJECTION');
    expect(decision.focusObjection?.type).toBe('PRICE');
    expect(decision.focusObjection?.attempts).toBe(0);
  });

  it('9. اعتراض قیمت برای بار سوم (attempts=2) → DORMANT / SOFT_EXIT (R6b)', () => {
    const prev = memory({
      stage: 'OBJECTION',
      turn: 6,
      lastGoal: 'HANDLE_OBJECTION',
      objections: [
        {
          type: 'PRICE',
          quote: 'گرونه',
          attempts: 2,
          status: 'ADDRESSED',
          lastTurn: 5,
        },
      ],
    });
    const { decision } = turn(
      prev,
      perception({
        primaryAct: 'OBJECTION',
        objection: { type: 'PRICE', quote: 'بازم گرونه' },
      }),
    );
    expect(decision.stage).toBe('DORMANT');
    expect(decision.goal).toBe('SOFT_EXIT');
    expect(decision.reason).toContain('R6b');
  });

  it('10. اعتراض ADDRESSED + «باشه» → RESOLVED و CLOSING / TRIAL_CLOSE (R17)', () => {
    const prev = memory({
      stage: 'OBJECTION',
      turn: 5,
      lastGoal: 'HANDLE_OBJECTION',
      objections: [
        {
          type: 'PRICE',
          quote: 'گرونه',
          attempts: 1,
          status: 'ADDRESSED',
          lastTurn: 5,
        },
      ],
    });
    const { decision, mem } = turn(
      prev,
      perception({ primaryAct: 'ACKNOWLEDGEMENT' }),
    );
    expect(mem.objections[0].status).toBe('RESOLVED');
    expect(decision.stage).toBe('CLOSING');
    expect(decision.goal).toBe('TRIAL_CLOSE');
  });

  it('11. «مرسی فعلاً» → DORMANT / SOFT_EXIT', () => {
    const { decision } = turn(
      memory({ stage: 'EVALUATION', turn: 3 }),
      perception({ primaryAct: 'DISENGAGE' }),
    );
    expect(decision.stage).toBe('DORMANT');
    expect(decision.goal).toBe('SOFT_EXIT');
  });

  it('12. HUMAN_REQUEST → shortCircuit HUMAN_HANDOFF', () => {
    const { decision } = turn(
      memory(),
      perception({ primaryAct: 'HUMAN_REQUEST' }),
    );
    expect(decision.shortCircuit).toBe('HUMAN_HANDOFF');
  });

  it('12b. HUMAN_REQUEST حین پرداخت و بعد از خرید هم قورت داده نمی‌شود', () => {
    for (const cs of ['AWAITING_PAYMENT', 'COMPLETED'] as const) {
      const { decision } = turn(
        memory({ turn: 3 }),
        perception({ primaryAct: 'HUMAN_REQUEST' }),
        facts({ conversationState: cs }),
      );
      expect(decision.shortCircuit).toBe('HUMAN_HANDOFF');
    }
  });

  it('13. SPAM → shortCircuit SPAM_REPLY', () => {
    const { decision } = turn(memory(), perception({ primaryAct: 'SPAM' }));
    expect(decision.shortCircuit).toBe('SPAM_REPLY');
  });

  it('14. AWAITING_PAYMENT → CHECKOUT / ASSIST_CHECKOUT؛ با اعتراض PAYMENT → HANDLE_OBJECTION', () => {
    const f = facts({
      conversationState: 'AWAITING_PAYMENT',
      cartItemCount: 1,
    });
    const prev = memory({ stage: 'CHECKOUT', turn: 5 });
    const a = turn(prev, perception({ primaryAct: 'POLICY_QUESTION' }), f);
    expect(a.decision.stage).toBe('CHECKOUT');
    expect(a.decision.goal).toBe('ASSIST_CHECKOUT');
    const b = turn(
      prev,
      perception({
        primaryAct: 'OBJECTION',
        objection: { type: 'PAYMENT', quote: 'قسطی میشه؟' },
      }),
      f,
    );
    expect(b.decision.stage).toBe('CHECKOUT');
    expect(b.decision.goal).toBe('HANDLE_OBJECTION');
  });

  it('15. COMPLETED + تشکر → POST_PURCHASE_CARE؛ COMPLETED + نیاز جدید → DISCOVERY/RECOMMENDATION', () => {
    const f = facts({ conversationState: 'COMPLETED' });
    const prev = memory({ stage: 'POST_PURCHASE', turn: 8 });
    const a = turn(prev, perception({ primaryAct: 'SMALL_TALK' }), f);
    expect(a.decision.stage).toBe('POST_PURCHASE');
    expect(a.decision.goal).toBe('POST_PURCHASE_CARE');
    const b = turn(
      prev,
      perception({ primaryAct: 'NEED_STATEMENT', needSummary: 'روسری' }),
      f,
    );
    expect(['DISCOVERY', 'RECOMMENDATION']).toContain(b.decision.stage);
  });

  it('16. سه نوبت EVALUATION با buyingSignal WEAK → نوبت سوم TRIAL_CLOSE (R15a)', () => {
    let mem = memory({
      stage: 'RECOMMENDATION',
      interests: [
        {
          id: 'p1',
          name: 'شال',
          priceToman: 500000,
          signal: 'SHOWN',
          note: null,
          lastTurn: 1,
        },
      ],
      turn: 1,
      lastGoal: 'RECOMMEND',
    });
    const decisions: SalesDecision[] = [];
    for (let i = 0; i < 3; i++) {
      const r = turn(
        mem,
        perception({
          primaryAct: 'PRODUCT_QUESTION',
          buyingSignal: 'WEAK',
          referencedProductIds: ['p1'],
        }),
      );
      decisions.push(r.decision);
      mem = recordAgentTurn(r.mem, r.decision, noOut);
    }
    expect(decisions[0].goal).toBe('ANSWER_AND_ADVANCE');
    expect(decisions[1].goal).toBe('ANSWER_AND_ADVANCE');
    expect(decisions[2].goal).toBe('TRIAL_CLOSE');
    expect(decisions[2].reason).toContain('R15a');
  });

  it('17. irrelevantStreak به ۲ رسید → NOT_A_FIT', () => {
    let mem = memory({ stage: 'OPENING', turn: 1 });
    let last: SalesDecision | null = null;
    for (let i = 0; i < 2; i++) {
      const r = turn(
        mem,
        perception({ primaryAct: 'OFF_TOPIC', storeRelevance: 'NOT_RELEVANT' }),
      );
      mem = recordAgentTurn(r.mem, r.decision, noOut);
      last = r.decision;
    }
    expect(mem.irrelevantStreak).toBe(2);
    expect(last?.stage).toBe('NOT_A_FIT');
    expect(last?.goal).toBe('HONEST_NOT_A_FIT');
  });

  it('18. ۲۲ ساعت سکوت + سلام، سبد پر → CHECKOUT / ASSIST_CHECKOUT و welcomeBack', () => {
    const prev = memory({
      stage: 'CHECKOUT',
      turn: 4,
      lastCustomerMessageAt: '2026-10-12T12:00:00.000Z',
    });
    const { decision } = turn(
      prev,
      perception({ primaryAct: 'GREETING' }),
      facts({ cartItemCount: 1 }),
    );
    expect(decision.stage).toBe('CHECKOUT');
    expect(decision.goal).toBe('ASSIST_CHECKOUT');
    expect(decision.welcomeBack).toBe(true);
  });

  it('19. شناسه‌ی ناشناخته در referencedProductIds حذف می‌شود', () => {
    const raw = perception({
      referencedProductIds: ['p1', 'ghost'],
      rejectedProductIds: ['ghost'],
    });
    const out = sanitizePerception(raw, ['p1']);
    expect(out.referencedProductIds).toEqual(['p1']);
    expect(out.rejectedProductIds).toEqual([]);
  });

  it('20. recordAgentTurn: سقف‌ها و stageEnteredTurn فقط با تغییر stage', () => {
    const interests: ProductInterest[] = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      name: `n${i}`,
      priceToman: 1000,
      signal: 'SHOWN',
      note: null,
      lastTurn: i,
    }));
    interests[0].signal = 'IN_CART';
    const prev = memory({
      stage: 'EVALUATION',
      stageEnteredTurn: 2,
      turn: 5,
      interests,
      askedQuestions: Array.from({ length: 8 }, (_, i) => ({
        text: `q${i}`,
        turn: i,
      })),
    });
    const decision: SalesDecision = {
      stage: 'EVALUATION',
      goal: 'ANSWER_AND_ADVANCE',
      reason: 't',
      focusObjection: null,
      welcomeBack: false,
      shortCircuit: null,
      allowedTools: [],
    };
    const next = recordAgentTurn(prev, decision, {
      ...noOut,
      askedQuestion: 'سؤال تازه؟',
      shownProducts: [{ id: 'new', name: 'جدید', priceToman: 5000 }],
    });
    expect(next.interests.length).toBe(8);
    expect(next.interests.some((i) => i.id === 'p0')).toBe(true); // IN_CART حذف نمی‌شود
    expect(next.interests.some((i) => i.id === 'new')).toBe(true);
    expect(next.askedQuestions.length).toBe(8);
    expect(next.askedQuestions[7].text).toBe('سؤال تازه؟');
    expect(next.stageEnteredTurn).toBe(2);
    const changed = recordAgentTurn(
      prev,
      { ...decision, stage: 'CLOSING' },
      noOut,
    );
    expect(changed.stageEnteredTurn).toBe(5);
  });

  it('20b. سقف اعتراض‌ها ۶ است', () => {
    let mem = memory({ turn: 1 });
    const types = [
      'PRICE',
      'TRUST',
      'QUALITY',
      'FIT',
      'TIMING',
      'SHIPPING',
      'PAYMENT',
    ] as const;
    for (const type of types) {
      mem = applyPerception(
        mem,
        perception({
          primaryAct: 'OBJECTION',
          objection: { type, quote: type },
        }),
        facts(),
      );
    }
    expect(mem.objections.length).toBe(6);
    expect(mem.objections[0].type).toBe('TRUST');
  });

  it('21. resolveAllowedTools برای leadCaptureOnly', () => {
    for (const goal of [
      'ASSIST_CHECKOUT',
      'EXECUTE_PURCHASE',
      'ALTERNATIVE_CLOSE',
      'ANSWER_AND_ADVANCE',
    ] as const) {
      const tools = resolveAllowedTools(goal, { leadCaptureOnly: true });
      expect(tools).not.toContain('create_order');
      expect(tools).not.toContain('update_cart');
    }
    expect(
      resolveAllowedTools('EXECUTE_PURCHASE', { leadCaptureOnly: true }),
    ).toContain('capture_lead');
    expect(
      resolveAllowedTools('EXECUTE_PURCHASE', { leadCaptureOnly: false }),
    ).toContain('create_order');
  });

  it('22. deriveLeadFunnelStage طبق جدول §۱۳', () => {
    expect(deriveLeadFunnelStage('OPENING')).toBe('NEW');
    expect(deriveLeadFunnelStage('DISCOVERY')).toBe('DISCOVERING_NEED');
    expect(deriveLeadFunnelStage('RECOMMENDATION')).toBe('PITCHED');
    expect(deriveLeadFunnelStage('EVALUATION')).toBe('PITCHED');
    expect(deriveLeadFunnelStage('OBJECTION')).toBe('OBJECTION_RAISED');
    expect(deriveLeadFunnelStage('CLOSING')).toBe('READY_TO_CAPTURE');
    expect(deriveLeadFunnelStage('CHECKOUT')).toBe('READY_TO_CAPTURE');
    expect(deriveLeadFunnelStage('NOT_A_FIT')).toBe('NOT_RELEVANT');
    expect(deriveLeadFunnelStage('DORMANT')).toBeNull();
    expect(deriveLeadFunnelStage('POST_PURCHASE')).toBeNull();
  });

  it('همه‌ی مرحله‌ها در جدول فانل پوشش داده شده‌اند', () => {
    for (const s of SALES_STAGES)
      expect(() => deriveLeadFunnelStage(s)).not.toThrow();
  });
});
