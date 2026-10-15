// docs/PRD-seller-panel-simplification.md §4.3 — اعتبارسنجی انتشار (DRAFT/HIDDEN → ACTIVE یا ساخت
// مستقیم ACTIVE). خالص و بدون DB تا تست‌پذیر بماند؛ لیست فیلدهای ناقص را برمی‌گرداند.
export type ProductMissingField = 'name' | 'price' | 'stock';

export interface PublishCandidate {
  name: string;
  basePrice: number;
  pricingModel: 'FIXED' | 'WEIGHT_BASED_FORMULA';
  trackStock: boolean;
  hasVariants: boolean;
  stockSetAt: Date | null;
}

export function missingForPublish(p: PublishCandidate): ProductMissingField[] {
  const missing: ProductMissingField[] = [];
  if (p.name.trim().length < 2) missing.push('name');
  if (p.pricingModel === 'FIXED' && !(p.basePrice > 0)) missing.push('price');
  if (p.trackStock && !p.hasVariants && !p.stockSetAt) missing.push('stock');
  return missing;
}
