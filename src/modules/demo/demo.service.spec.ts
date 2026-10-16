import { DemoService } from './demo.service';
import { DEMO_FAKE_CARD_NUMBER } from '../../common/utils/store-mode';

describe('DemoService.ensureDemoStore (DEMO-3 کپی کامل)', () => {
  const build = () => {
    const calls: Record<string, any[]> = {
      store: [], card: [], product: [], kb: [], rule: [], discount: [],
    };
    let n = 0;
    const tx = {
      store: { create: jest.fn(async ({ data }) => { calls.store.push(data); return { id: 'clone', slug: data.slug }; }) },
      storeBankCard: { create: jest.fn(async ({ data }) => { calls.card.push(data); }) },
      product: { create: jest.fn(async ({ data }) => { calls.product.push(data); return { id: `np${++n}` }; }) },
      storeKbEntry: { create: jest.fn(async ({ data }) => { calls.kb.push(data); }) },
      storeShippingRule: { createMany: jest.fn(async ({ data }) => { calls.rule.push(...data); }) },
      storeDiscountCode: { create: jest.fn(async ({ data }) => { calls.discount.push(data); }) },
    };
    const template = {
      id: 't1', name: 'قالب', category: 'پوشاک', businessType: 'PRODUCT_SALES',
      bankCardNumber: '6037999999999999', bankOwnerName: 'واقعی',
      requiresShipping: true, returnWindowDays: 7, returnPolicyMode: 'NONE', returnShippingPaidBy: 'BUYER',
      goldVatPercent: 10, persuasionTechniquesEnabled: true,
      products: [{
        id: 'p1', name: 'مانتو', basePrice: 1000, stock: 5, trackStock: true, stockSetAt: null,
        description: 'd', images: [], videos: [], specs: { جنس: 'نخ' }, code: null, hasFulfillmentDelay: false,
        persuasionTechniquesEnabled: true, pricingModel: 'FIXED',
        optionTypes: [
          { name: 'سایز', position: 0, values: [{ value: 'M', position: 0 }, { value: 'L', position: 1 }] },
          { name: 'رنگ', position: 1, values: [{ value: 'مشکی', position: 0 }, { value: 'سفید', position: 1 }] },
        ],
        variants: [1, 2, 3, 4].map((i) => ({ optionValues: { سایز: 'M', رنگ: `c${i}` }, priceOverride: null, stock: i })),
      }],
      kbEntries: [
        { relatedProductId: 'p1', kind: 'FAQ', question: 'q1', answer: 'a1', tags: [] },
        { relatedProductId: null, kind: 'FAQ', question: 'q2', answer: 'a2', tags: [] },
        { relatedProductId: 'gone', kind: 'FAQ', question: 'q3', answer: 'a3', tags: [] },
      ],
      shippingRules: [{ provinces: ['تهران'], cost: 50000, enabled: true }],
      discountCodes: [],
    };
    const prisma: any = {
      store: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(template) },
      $transaction: jest.fn(async (fn) => fn(tx)),
    };
    const redis: any = { incr: jest.fn(async () => 1), expire: jest.fn() };
    return { svc: new DemoService(prisma, redis), calls };
  };

  it('همه‌ی بخش‌ها کپی می‌شوند و شماره کارت قالب هرگز نه', async () => {
    const { svc, calls } = build();
    const res = await svc.ensureDemoStore('u1', 'clothing');
    expect(res.storeId).toBe('clone');
    expect(calls.store[0].leadCaptureOnly).toBe(false);
    expect(calls.store[0].isDemo).toBe(true);
    expect(calls.store[0].bankCardNumber).toBe(DEMO_FAKE_CARD_NUMBER);
    expect(calls.card[0].cardNumber).toBe(DEMO_FAKE_CARD_NUMBER);
    expect(calls.product[0].optionTypes.create).toHaveLength(2);
    expect(calls.product[0].variants.create).toHaveLength(4);
    expect(calls.product[0].specs).toEqual({ جنس: 'نخ' });
    expect(calls.kb.map((k) => k.question)).toEqual(['q1', 'q2']);
    expect(calls.kb[0].relatedProductId).toBe('np1');
    expect(calls.rule).toHaveLength(1);
  });
});
