jest.mock('ai', () => ({ ...jest.requireActual('ai'), generateObject: jest.fn() }));
import { generateObject } from 'ai';
import { ProductQualityReviewService, productInputHash, shouldReview } from './product-quality-review.service';

const product = {
  id: 'p1', storeId: 's1', name: 'مانتو لینن', description: 'جنس لینن', specs: { جنس: 'لینن' }, basePrice: 1000, images: ['a', 'b'],
  store: { id: 's1', category: 'پوشاک', sellerId: 'u1' },
  optionTypes: [{ name: 'سایز', values: [{ value: 'M' }, { value: 'L' }] }],
};

function build(opts: { row?: { inputHash: string; review: unknown } | null; tableMissing?: boolean; events?: unknown[]; incr?: number } = {}) {
  const upsert = jest.fn(async () => ({}));
  const prisma: any = {
    product: { findUnique: jest.fn(async () => product) },
    contentQualityReview: {
      findUnique: jest.fn(async () => { if (opts.tableMissing) throw new Error('relation does not exist'); return opts.row ?? null; }),
      upsert,
    },
    productEvent: { findMany: jest.fn(async () => opts.events ?? []) },
    creditUsageEvent: { create: jest.fn(async () => ({})) },
  };
  const redis: any = { incr: jest.fn(async () => opts.incr ?? 1), expire: jest.fn() };
  const aiProvider: any = { buildClient: () => () => 'model' };
  const pricing: any = { calcCost: jest.fn(async () => ({ costToman: 1 })) };
  return { svc: new ProductQualityReviewService(prisma, redis, aiProvider, pricing), prisma, upsert };
}

const llmOut = {
  score: 70, level: 'good', summary: 'خوبه', items: [{ key: 'material', status: 'ok', note: null }, { key: 'bogus', status: 'ok', note: null }],
  suggestions: [{ key: 'size_real', title: 't', why: 'w', askPrompt: 'a', exampleText: 'e' }, { key: 'bogus', title: 't', why: 'w', askPrompt: 'a', exampleText: 'e' }],
  buyerQuestionsUnanswered: [],
};

beforeEach(() => (generateObject as jest.Mock).mockReset().mockResolvedValue({ object: llmOut, usage: { inputTokens: 1, outputTokens: 1 } }));

describe('ProductQualityReviewService', () => {
  it('shouldReview: بدون اسم یا بدون هیچ محتوا → نه', () => {
    expect(shouldReview({ name: '', description: 'x', specs: null, options: [] })).toBe(false);
    expect(shouldReview({ name: 'x', description: '', specs: null, options: [] })).toBe(false);
    expect(shouldReview({ name: 'x', description: 'd', specs: null, options: [] })).toBe(true);
  });

  it('run: ذخیره می‌کند و کلیدهای نامعتبر را حذف می‌کند', async () => {
    const { svc, upsert } = build();
    expect(await svc.run('p1', false)).toBe('done');
    const saved = (upsert.mock.calls[0] as any)[0].create.review;
    expect(saved.items.map((i: any) => i.key)).toEqual(['material']);
    expect(saved.suggestions).toHaveLength(1);
  });

  it('hash تکراری → job/LLM نیست', async () => {
    const hash = productInputHash({
      name: product.name, description: product.description, specs: product.specs, options: [{ name: 'سایز', values: ['M', 'L'] }], basePrice: 1000, imageCount: 2,
    });
    const { svc } = build({ row: { inputHash: hash, review: llmOut } });
    expect(await svc.run('p1', false)).toBe('skipped');
    expect(generateObject).not.toHaveBeenCalled();
    expect(await svc.run('p1', true)).toBe('done'); // دستی: بازبینی اجباری
  });

  it('SQL اجرانشده → rules_only بدون خطا', async () => {
    const { svc } = build({ tableMissing: true });
    const res = await svc.getReview('u1', 's1', 'p1');
    expect(res.status).toBe('rules_only');
    expect(res.rules.items.length).toBeGreaterThan(0);
    expect(await svc.run('p1', false)).toBe('no_table');
  });

  it('سقف روزانه ۶۰', async () => {
    const { svc } = build({ incr: 61 });
    expect(await svc.run('p1', false)).toBe('capped');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('PQ-5: ۳ faq_miss روی یک محصول در بررسی بعدی می‌آید', async () => {
    const ev = ['آبرفت داره؟', 'آبرفت داره', 'آبرفت داره؟؟'].map((q) => ({ props: { productId: 'p1', question: q } }))
      .concat([{ props: { productId: 'other', question: 'x' } }]);
    const { svc, upsert } = build({ events: ev });
    expect(await svc.unansweredQuestions('s1', 'p1')).toEqual(['آبرفت داره؟']);
    await svc.run('p1', false);
    expect((upsert.mock.calls[0] as any)[0].create.review.buyerQuestionsUnanswered).toEqual(['آبرفت داره؟']);
  });
});
