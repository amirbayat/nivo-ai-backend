import { lineKey, reconcileCart, type CatalogLine } from './cart-validation.util';
import { fa } from '../../i18n/fa';

const item = { productId: 'p1', variantId: undefined, qty: 3, name: 'مانتو', unitPrice: 100 } as never;

describe('reconcileCart with SP-3 stock modes', () => {
  it('untracked line (stock null) passes any qty and never decrements anything', () => {
    const catalog = new Map<string, CatalogLine>([[lineKey(item), { unitPrice: 100, stock: null }]]);
    expect(reconcileCart([item], catalog)).toEqual({ status: 'OK' });
  });
  it('tracked line with stock 0 is rejected as before', () => {
    const catalog = new Map<string, CatalogLine>([[lineKey(item), { unitPrice: 100, stock: 0 }]]);
    expect(reconcileCart([item], catalog).status).toBe('OUT_OF_STOCK');
  });
  it('a product that became HIDDEN (missing from catalog) is removed and named to the buyer', () => {
    const catalog = new Map<string, CatalogLine>([[lineKey(item), null]]);
    const rec = reconcileCart([item], catalog);
    expect(rec.status).toBe('OUT_OF_STOCK');
    if (rec.status !== 'OUT_OF_STOCK') return;
    expect(rec.shortages[0]).toMatchObject({ name: 'مانتو', unavailable: true });
    const msg = fa.salesAgent.orderOutOfStock(rec.shortages);
    expect(msg).toContain('مانتو: این محصول الان فروشی نیست');
  });
});
