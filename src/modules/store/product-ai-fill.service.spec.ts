import { HttpException, NotFoundException } from '@nestjs/common';

jest.mock('ai', () => ({ generateObject: jest.fn(), generateText: jest.fn(), embed: jest.fn(), cosineSimilarity: jest.fn() }));
jest.mock('sharp', () => () => ({}), { virtual: true });

import { generateObject } from 'ai';
import { AI_FILL_DAILY_LIMIT, ProductAiFillService, normalizeAiFill, type AiFillModelOutput } from './product-ai-fill.service';

const raw = (over: Partial<AiFillModelOutput> = {}): AiFillModelOutput => ({
  name: 'مانتو لینن', description: 'مانتو سبک و راحت.', stock: null, alwaysInStock: null,
  weightGrams: null, purityKarat: null, specs: [], variantOptions: [], assumptions: [], ...over,
});

describe('normalizeAiFill [SP-4]', () => {
  it('price comes from the parser, never from the model', () => {
    const r = normalizeAiFill(raw(), 'مانتو لینن، ۸۹۰ هزار تومن، سایز ۳۸', { pricingModel: 'FIXED' });
    expect(r.basePrice).toBe(890000);
  });
  it('text without a price → missing contains price', () => {
    const r = normalizeAiFill(raw(), 'مانتو لینن مشکی', { pricingModel: 'FIXED' });
    expect(r.basePrice).toBeUndefined();
    expect(r.missing).toContain('price');
  });
  it('«همیشه داریم» → trackStock=false and stock is not missing', () => {
    const r = normalizeAiFill(raw(), 'کیف دست‌دوز ۵۰۰ هزار تومن، همیشه داریم', { pricingModel: 'FIXED' });
    expect(r.trackStock).toBe(false);
    expect(r.missing).not.toContain('stock');
  });
  it('variants replace the need for a top-level stock', () => {
    const r = normalizeAiFill(
      raw({ variantOptions: [{ name: 'سایز', values: [{ value: '۳۸', stock: null }, { value: '۴۰', stock: 2 }] }] }),
      'مانتو ۱ میلیون تومن', { pricingModel: 'FIXED' });
    expect(r.variantOptions?.[0].values).toEqual([{ value: '۳۸' }, { value: '۴۰', stock: 2 }]);
    expect(r.missing).toEqual([]);
  });
  it('gold product: no price missing, weight and purity kept', () => {
    const r = normalizeAiFill(raw({ weightGrams: 3, purityKarat: 18 }), 'گردنبند ۳ گرم ۱۸ عیار', { pricingModel: 'WEIGHT_BASED_FORMULA' });
    expect(r.missing).not.toContain('price');
    expect(r).toMatchObject({ weightGrams: 3, purityKarat: 18 });
  });
  it('name is capped at 60 chars', () => {
    expect(normalizeAiFill(raw({ name: 'ا'.repeat(90) }), '', { pricingModel: 'FIXED' }).name).toHaveLength(60);
  });
});

describe('ProductAiFillService.fill [SP-4]', () => {
  function build(opts: { product?: object | null; count?: number } = {}) {
    const svc = Object.create(ProductAiFillService.prototype) as ProductAiFillService;
    const log = jest.fn();
    Object.assign(svc, {
      prisma: { product: { findUnique: async () => (opts.product === undefined ? { id: 'p1', storeId: 's1', status: 'DRAFT', images: [], name: '', pricingModel: 'FIXED' } : opts.product) } },
      storeService: { getOwned: async () => ({ category: 'پوشاک' }) },
      productEvents: { countSince: async () => opts.count ?? 0, log },
      aiProvider: { buildClient: () => () => ({}) },
      storage: { downloadImage: jest.fn() },
      logger: { warn: jest.fn(), error: jest.fn() },
    });
    return { svc, log };
  }

  it('over the daily limit → 429', async () => {
    const { svc } = build({ count: AI_FILL_DAILY_LIMIT });
    await expect(svc.fill('u', 's1', 'p1', 'x')).rejects.toMatchObject({ status: 429 });
  });
  it('a product of another store → 404', async () => {
    const { svc } = build({ product: { id: 'p1', storeId: 'OTHER', status: 'DRAFT', images: [], pricingModel: 'FIXED' } });
    await expect(svc.fill('u', 's1', 'p1', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('HIDDEN product → 404', async () => {
    const { svc } = build({ product: { id: 'p1', storeId: 's1', status: 'HIDDEN', images: [], pricingModel: 'FIXED' } });
    await expect(svc.fill('u', 's1', 'p1', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('success logs product_ai_draft ok=true and returns the normalized fill', async () => {
    (generateObject as jest.Mock).mockResolvedValue({ object: raw() });
    const { svc, log } = build();
    const r = await svc.fill('u', 's1', 'p1', 'مانتو لینن ۸۹۰ هزار تومن');
    expect(r.basePrice).toBe(890000);
    expect(log).toHaveBeenCalledWith('product_ai_draft', expect.anything(), expect.objectContaining({ ok: true, hasText: true }));
  });
  it('every model failing → 502 with the Persian message and ok=false logged', async () => {
    (generateObject as jest.Mock).mockRejectedValue(new Error('boom'));
    const { svc, log } = build();
    await expect(svc.fill('u', 's1', 'p1', 'x')).rejects.toMatchObject({ status: 502 });
    expect(log).toHaveBeenCalledWith('product_ai_draft', expect.anything(), expect.objectContaining({ ok: false }));
  });
  it('HttpException type for 429', () => {
    expect(new HttpException('x', 429).getStatus()).toBe(429);
  });
});
