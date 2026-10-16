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
    return { svc: new DemoService(prisma, redis, {} as any, { log: jest.fn() } as any), calls };
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

describe('DemoService.convertToReal (DEMO-4)', () => {
  const build = (existingReal = 0) => {
    const calls: any = {};
    const tx = {
      storeBankCard: { deleteMany: jest.fn(async (a) => { calls.cards = a; }) },
      product: { updateMany: jest.fn(async (a) => { calls.products = a; }) },
      store: { update: jest.fn(async (a) => { calls.store = a.data; return { id: 's1', isDemo: false, ...a.data }; }) },
    };
    const prisma: any = {
      store: {
        findUnique: jest.fn(async () => ({ id: 's1', sellerId: 'u1', isDemo: true, name: 'قالب' })),
        count: jest.fn(async () => existingReal),
      },
      $transaction: jest.fn(async (fn) => fn(tx)),
    };
    const events = { log: jest.fn() };
    const storeService: any = {
      newStoreTrialData: jest.fn(async () => ({ trialCreditRemainingToman: 300000, trialStartedAt: new Date(), trialEndsAt: new Date() })),
      suggestSlug: jest.fn(async () => ({ slug: 'ghaleb' })),
      afterRealStoreCreated: jest.fn(),
    };
    return { svc: new DemoService(prisma, {} as any, storeService, events as any), calls, storeService, events };
  };

  it('اعتبار هدیه، کارت خالی، محصولات DRAFT، slug جدید و رویداد', async () => {
    const { svc, calls, storeService, events } = build();
    await svc.convertToReal('u1', 's1');
    expect(events.log).toHaveBeenCalledWith('demo_converted', { storeId: 's1', userId: 'u1' }, expect.anything());
    expect(calls.store.trialCreditRemainingToman).toBe(300000);
    expect(calls.store.bankCardNumber).toBeNull();
    expect(calls.store.slug).toBe('ghaleb');
    expect(calls.store.isDemo).toBe(false);
    expect(calls.cards.where.storeId).toBe('s1');
    expect(calls.products.data.status).toBe('DRAFT');
    expect(storeService.afterRealStoreCreated).toHaveBeenCalledWith('u1', expect.anything(), expect.any(Date), { fromDemo: true });
  });

  it('اگر فروشنده از قبل فروشگاه واقعی دارد → Conflict', async () => {
    const { svc } = build(1);
    await expect(svc.convertToReal('u1', 's1')).rejects.toThrow();
  });
});

describe('DemoService.logPanelTourEvent (DEMO-6)', () => {
  const mk = (store: unknown) => {
    const events = { log: jest.fn() };
    const prisma: any = { store: { findUnique: jest.fn(async () => store) } };
    return { svc: new DemoService(prisma, {} as any, {} as any, events as any), events };
  };
  it('whitelist: فقط دو رویداد پنل', async () => {
    const { svc } = mk({ sellerId: 'u1', isDemo: true, category: 'پوشاک' });
    await expect(svc.logPanelTourEvent('u1', 's1', 'demo_converted')).rejects.toThrow();
    await expect(svc.logPanelTourEvent('u1', 's1', 'hack')).rejects.toThrow();
  });
  it('مالک فروشگاه دمو → ثبت با category', async () => {
    const { svc, events } = mk({ sellerId: 'u1', isDemo: true, category: 'پوشاک' });
    await svc.logPanelTourEvent('u1', 's1', 'demo_order_confirmed');
    expect(events.log).toHaveBeenCalledWith('demo_order_confirmed', { storeId: 's1', userId: 'u1' }, { category: 'پوشاک' });
  });
  it('غیرمالک یا فروشگاه غیردمو → ۴۰۴', async () => {
    await expect(mk({ sellerId: 'x', isDemo: true, category: 'a' }).svc.logPanelTourEvent('u1', 's1', 'demo_order_confirmed')).rejects.toThrow();
    await expect(mk({ sellerId: 'u1', isDemo: false, category: 'a' }).svc.logPanelTourEvent('u1', 's1', 'demo_order_confirmed')).rejects.toThrow();
  });
});
