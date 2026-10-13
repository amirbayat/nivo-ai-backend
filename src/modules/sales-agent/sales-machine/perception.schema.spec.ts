import {
  buildPerceptionPrompt,
  neutralPerception,
  perceptionSchema,
  sanitizePerception,
} from './perception.schema';
import {
  emptySlots,
  loadSalesMemory,
  summarizeCart,
} from './sales-memory.util';
import { perception } from './sales-machine.test-utils';

describe('sanitizePerception', () => {
  it('شناسه‌های ناشناخته حذف می‌شوند', () => {
    const out = sanitizePerception(
      perception({
        referencedProductIds: ['a', 'x'],
        rejectedProductIds: ['y'],
      }),
      ['a'],
    );
    expect(out.referencedProductIds).toEqual(['a']);
    expect(out.rejectedProductIds).toEqual([]);
  });

  it('بودجه: <۱۰۰۰ ×۱۰۰۰، >۱۰ میلیارد null، idempotent', () => {
    const p = perception();
    p.slotUpdates.budgetMaxToman = 500;
    p.slotUpdates.budgetMinToman = 20_000_000_000;
    const once = sanitizePerception(p, []);
    expect(once.slotUpdates.budgetMaxToman).toBe(500000);
    expect(once.slotUpdates.budgetMinToman).toBeNull();
    expect(sanitizePerception(once, [])).toEqual(once);
  });

  it('quote اعتراض به ۱۲۰ کاراکتر و ترجیحات dedupe می‌شوند', () => {
    const p = perception({
      objection: { type: 'PRICE', quote: 'ا'.repeat(300) },
    });
    p.slotUpdates.addPreferences = ['ساده', 'ساده', 'نخی'];
    const out = sanitizePerception(p, []);
    expect(out.objection?.quote.length).toBe(120);
    expect(out.slotUpdates.addPreferences).toEqual(['ساده', 'نخی']);
  });
});

describe('perception helpers', () => {
  it('neutralPerception با schema معتبر است و primaryAct از interests می‌آید', () => {
    expect(
      perceptionSchema.safeParse(neutralPerception({ interests: [] })).success,
    ).toBe(true);
    expect(neutralPerception({ interests: [] }).primaryAct).toBe(
      'NEED_STATEMENT',
    );
    const withInterest = neutralPerception({
      interests: [
        {
          id: 'a',
          name: 'n',
          priceToman: 1,
          signal: 'SHOWN',
          note: null,
          lastTurn: 0,
        },
      ],
    });
    expect(withInterest.primaryAct).toBe('PRODUCT_QUESTION');
  });

  it('buildPerceptionPrompt قیمت صفر را چاپ نمی‌کند', () => {
    const prompt = buildPerceptionPrompt({
      storeContextSummary: 'شال',
      stage: 'OPENING',
      lastGoal: null,
      lastAgentMessage: null,
      lastAgentQuestion: null,
      lastCloseOffer: null,
      knownSlots: emptySlots(),
      mentionedProducts: [{ id: 'p1', name: 'شال', priceToman: 0 }],
      cartSummary: 'خالی',
      recentTranscript: '',
    });
    expect(prompt).toContain('p1 — شال');
    expect(prompt).not.toContain('0 تومان');
  });

  it('loadSalesMemory: مهاجرت از customerState و lastShownProducts', () => {
    const mem = loadSalesMemory({
      cart: [],
      customerState: {
        pain: 'پوست خشک',
        painSolvable: 'YES',
        empathyShown: true,
        attentionCaptured: true,
        stage: 'READY',
      },
      lastShownProducts: [{ id: 'p1', name: 'کرم' }],
    });
    expect(mem.stage).toBe('CLOSING');
    expect(mem.needSummary).toBe('پوست خشک');
    expect(mem.interests[0]).toMatchObject({
      id: 'p1',
      priceToman: 0,
      signal: 'SHOWN',
    });
    expect(loadSalesMemory({ cart: [] }).stage).toBe('OPENING');
  });

  it('summarizeCart', () => {
    expect(summarizeCart([])).toBe('خالی');
    expect(summarizeCart([{ name: 'شال', qty: 2, variantLabel: 'کرم' }])).toBe(
      'شال (کرم) × 2',
    );
  });
});
