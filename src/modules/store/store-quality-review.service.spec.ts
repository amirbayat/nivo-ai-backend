jest.mock('ai', () => ({ ...jest.requireActual('ai'), generateObject: jest.fn() }));
import { generateObject } from 'ai';
import { StoreQualityReviewService } from './store-quality-review.service';

const store = {
  id: 's1', sellerId: 'u1', category: 'آرایشی و بهداشتی', requiresShipping: true, brandIntro: 'فروشگاه لوازم آرایشی', returnPolicy: null, shippingInfo: null,
  ownerNotes: 'مرجوعی تا ۷ روز، فقط پلمپ', shippingDaysMin: null, shippingDaysMax: null, returnPolicyMode: 'NONE', returnWindowDays: 3, returnShippingPaidBy: 'SELLER',
  workingHoursStart: null, workingHoursEnd: null, logoImageKey: null, instagramUrl: null, leadCaptureOnly: false,
  bankCardNumber: '6037991234567890', bankOwnerName: 'علی', snapppayPaymentLink: null,
  bankCards: [{ id: 'c1' }], shippingRules: [], attentionSuggestions: { topics: [{ topic: 't', field: 'returnPolicy', summary: 'مرجوعی دارین؟', occurrences: 4 }, { topic: 'o', field: 'other', summary: 'x', occurrences: 9 }] },
};

function build(opts: { row?: any; tableMissing?: boolean; incr?: number; events?: any[]; store?: any } = {}) {
  const upsert = jest.fn(async () => ({}));
  const prisma: any = {
    store: { findUnique: jest.fn(async () => opts.store ?? store) },
    storeKbEntry: { findMany: jest.fn(async () => [{ question: 'q1' }]) },
    productEvent: { findMany: jest.fn(async () => opts.events ?? []) },
    contentQualityReview: { findUnique: jest.fn(async () => { if (opts.tableMissing) throw new Error('no table'); return opts.row ?? null; }), upsert },
    creditUsageEvent: { create: jest.fn(async () => ({})) },
  };
  const redis: any = { incr: jest.fn(async () => opts.incr ?? 1), expire: jest.fn() };
  return { svc: new StoreQualityReviewService(prisma, redis, { buildClient: () => () => 'm' } as any, { calcCost: async () => ({ costToman: 1 }) } as any), prisma, upsert };
}

const out = {
  score: 54, level: 'ok', summary: 'خوب', items: [{ key: 'return_policy', status: 'missing', note: null }, { key: 'bogus', status: 'ok', note: null }],
  suggestions: [{ key: 'return_policy', title: 't', why: 'w', askPrompt: 'a', exampleText: 'تا ۷ روز', fromNotes: true }, { key: 'zzz', title: 't', why: 'w', askPrompt: 'a', exampleText: 'e', fromNotes: false }],
  buyerQuestionsUnanswered: [], trustLines: ['اصالت کالا با لیبل شرکتی', 'ارسال با ۵۰ هزار تومان'],
};
beforeEach(() => (generateObject as jest.Mock).mockReset().mockResolvedValue({ object: out, usage: { inputTokens: 1, outputTokens: 1 } }));

describe('StoreQualityReviewService (SQ-2/3/5)', () => {
  it('ذخیره: کلید نامعتبر حذف، target اضافه، trustLines بدون قیمت، سؤال‌های attention (field≠other)', async () => {
    const { svc, upsert } = build();
    expect(await svc.run('s1', false)).toBe('done');
    const saved = (upsert.mock.calls[0] as any)[0].create;
    expect(saved.entityType).toBe('STORE');
    const r = saved.review;
    expect(r.items.map((i: any) => i.key)).toEqual(['return_policy']);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({ target: 'returnPolicy', fromNotes: true });
    expect(r.trustLines).toEqual(['اصالت کالا با لیبل شرکتی']);
    expect(r.buyerQuestionsUnanswered).toEqual(['مرجوعی دارین؟']);
  });

  it('شماره کارت هرگز در ورودی LLM نیست', async () => {
    const { svc } = build();
    await svc.run('s1', false);
    const prompt = JSON.stringify((generateObject as jest.Mock).mock.calls[0][0]);
    expect(prompt).not.toContain('6037991234567890');
    expect(prompt).toContain('CARD_TO_CARD');
  });

  it('REV-3: کارت/شبا داخل یادداشت فروشنده و جواب apply ماسک می‌شود', async () => {
    const notes = 'کارت ۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۰ و شبا IR120170000000123456789012';
    const { svc } = build({ store: { ...store, ownerNotes: notes } });
    await svc.run('s1', false);
    const prompt = JSON.stringify((generateObject as jest.Mock).mock.calls[0][0]);
    expect(prompt).not.toMatch(/۹۹۱۲|9912/);
    expect(prompt).not.toContain('0170000000123456');
    (generateObject as jest.Mock).mockResolvedValueOnce({ object: { newText: 'x', returnWindowDays: null, returnShippingPaidBy: null } });
    await svc.apply('u1', 's1', 'return_policy', 'به کارت 6037991234567890 بزنن');
    expect(JSON.stringify((generateObject as jest.Mock).mock.calls[1][0])).not.toContain('99123456');
  });

  it('REV-4: apply بعد از سقف روزانه → 429', async () => {
    const { svc } = build({ incr: 41 });
    await expect(svc.apply('u1', 's1', 'return_policy', 'هفت روز')).rejects.toMatchObject({ status: 429 });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('SQ-5: ۳ faq_miss بدون محصول درباره‌ی مرجوعی → در لیست', async () => {
    const events = ['مرجوعی دارین؟', 'مرجوعی دارین', 'مرجوعی دارین؟؟'].map((q) => ({ props: { productId: null, question: q } }))
      .concat([{ props: { productId: 'p1', question: 'محصولی' } } as any]);
    const { svc } = build({ events });
    const qs = await svc.unansweredQuestions('s1', { topics: [] });
    expect(qs).toEqual([{ text: 'مرجوعی دارین؟', field: null }]);
  });

  it('hash تکراری (در همان روز) → skip؛ دستی → اجرا؛ سقف ۲۰ و جدول نبود', async () => {
    const first = build();
    await first.svc.run('s1', false);
    const row = { inputHash: (first.upsert.mock.calls[0] as any)[0].create.inputHash, reviewedAt: new Date() };
    (generateObject as jest.Mock).mockClear();
    const again = build({ row });
    expect(await again.svc.run('s1', false)).toBe('skipped');
    expect(generateObject).not.toHaveBeenCalled();
    expect(await again.svc.run('s1', true)).toBe('done');
    expect(await build({ incr: 21 }).svc.run('s1', false)).toBe('capped');
    expect(await build({ tableMissing: true }).svc.run('s1', false)).toBe('no_table');
    const res = await build({ tableMissing: true }).svc.getReview('u1', 's1');
    expect(res.status).toBe('rules_only');
    expect(res.rules.items.find((i) => i.key === 'shipping_days')?.status).toBe('missing');
  });

  it('apply: فقط فیلد متنی؛ ساخت‌یافته → ۴۰۴؛ پیشنهاد مهلت/هزینه وقتی فرق دارد', async () => {
    const { svc } = build();
    (generateObject as jest.Mock).mockResolvedValueOnce({ object: { newText: 'مرجوعی تا ۷ روز، فقط پلمپ، هزینه‌ی برگشت با مشتری', returnWindowDays: 7, returnShippingPaidBy: 'BUYER' } });
    const res = await svc.apply('u1', 's1', 'return_policy', '۷ روز، فقط اگه پلمپ باز نشده، هزینه برگشت با مشتری');
    expect(res).toMatchObject({ field: 'returnPolicy', suggestedReturnWindowDays: 7, suggestedReturnShippingPaidBy: 'BUYER' });
    await expect(svc.apply('u1', 's1', 'logo', 'x')).rejects.toThrow();
  });
});
