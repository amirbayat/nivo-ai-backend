import { missingForPublish, type PublishCandidate } from './product-publish.util';

const ready: PublishCandidate = {
  name: 'مانتو',
  basePrice: 890000,
  pricingModel: 'FIXED',
  trackStock: true,
  hasVariants: false,
  stockSetAt: new Date(),
};

describe('missingForPublish [SP-3]', () => {
  it('complete product has nothing missing', () => {
    expect(missingForPublish(ready)).toEqual([]);
  });
  it('returns exactly the missing fields', () => {
    expect(missingForPublish({ ...ready, name: ' a ', basePrice: 0, stockSetAt: null })).toEqual([
      'name',
      'price',
      'stock',
    ]);
    expect(missingForPublish({ ...ready, basePrice: 0 })).toEqual(['price']);
  });
  it('gold product does not need basePrice', () => {
    expect(missingForPublish({ ...ready, pricingModel: 'WEIGHT_BASED_FORMULA', basePrice: 0 })).toEqual([]);
  });
  it('untracked or variant products do not need stock', () => {
    expect(missingForPublish({ ...ready, trackStock: false, stockSetAt: null })).toEqual([]);
    expect(missingForPublish({ ...ready, hasVariants: true, stockSetAt: null })).toEqual([]);
  });
});
