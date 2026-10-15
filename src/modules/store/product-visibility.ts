import type { Prisma } from '@prisma/client';

// docs/PRD-seller-panel-simplification.md §4.3 — تنها نقطه‌ی تصمیم «خریدار/AI چه محصولی می‌بیند»
// و «آیا موجود است». هر کوئری رو به خریدار/AI باید BUYER_VISIBLE را بگیرد؛ هر چک موجودی از
// isPurchasable/availableQty رد شود (trackStock=false یعنی «همیشه موجود»).
export const BUYER_VISIBLE = { status: 'ACTIVE' } satisfies Prisma.ProductWhereInput;

interface StockProduct {
  status?: string | null;
  trackStock?: boolean | null;
  stock: number;
}
interface StockVariant {
  stock: number;
}

// null = نامحدود
export function availableQty(product: StockProduct, variant: StockVariant | null): number | null {
  if (product.trackStock === false) return null;
  return variant ? variant.stock : product.stock;
}

export function isPurchasable(product: StockProduct, variant: StockVariant | null, qty: number): boolean {
  if (product.status != null && product.status !== 'ACTIVE') return false;
  const avail = availableQty(product, variant);
  return avail === null || avail >= qty;
}

// «همیشه موجود» برای مسیرهایی که فقط عدد می‌فهمند (کارت‌های خریدار، `stock > 0` در فرانت و
// پرامپت‌ها): عدد بزرگی که هرگز به‌عنوان تعداد نمایش داده نمی‌شود. تصمیم‌گیری موجودی همیشه از
// isPurchasable/availableQty است؛ این فقط برای فرمت‌های عددی قدیمی است.
export const UNLIMITED_STOCK = 1_000_000;

export function applyUntrackedStock<
  T extends { trackStock?: boolean | null; stock: number; variants?: { stock: number }[] },
>(product: T): T {
  if (product.trackStock !== false) return product;
  product.stock = UNLIMITED_STOCK;
  for (const v of product.variants ?? []) v.stock = UNLIMITED_STOCK;
  return product;
}
