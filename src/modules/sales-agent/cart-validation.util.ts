import { CART_MAX_QTY_PER_LINE } from '../../common/constants/sales-ops.constants';
import type { CartItem } from './sales-agent.types';

// PRD-nivo-sales-unified.md تسک‌های 0.2 و 0.3 — منطق خالص (بدون DB) اعتبارسنجی سبد؛
// موتور گفتگو داده‌ی تازه را می‌خواند و اینجا فقط مقایسه می‌شود.

export function isValidCartQty(qty: unknown): qty is number {
  return (
    typeof qty === 'number' &&
    Number.isInteger(qty) &&
    qty >= 1 &&
    qty <= CART_MAX_QTY_PER_LINE
  );
}

export type CatalogLine = {
  // قیمت واحد فعلی (واریانت اگر دارد، وگرنه محصول) و موجودی فعلی؛ null = محصول/واریانت دیگر وجود ندارد
  unitPrice: number;
  // null = «همیشه موجود» (trackStock=false)
  stock: number | null;
} | null;

export type CartReconciliation =
  | { status: 'INVALID_QTY' }
  | {
      status: 'OUT_OF_STOCK';
      shortages: {
        name: string;
        requested: number;
        available: number;
        // محصول/مدل دیگر برای فروش نیست (پنهان/پیش‌نویس/حذف) — پیام «الان فروشی نیست»
        unavailable?: boolean;
      }[];
    }
  | {
      status: 'PRICE_CHANGED';
      cart: CartItem[];
      changes: { name: string; from: number; to: number }[];
    }
  | { status: 'OK' };

export function lineKey(item: Pick<CartItem, 'productId' | 'variantId'>) {
  return `${item.productId}::${item.variantId ?? ''}`;
}

export function reconcileCart(
  cart: CartItem[],
  catalog: Map<string, CatalogLine>,
): CartReconciliation {
  if (cart.some((i) => !isValidCartQty(i.qty)))
    return { status: 'INVALID_QTY' };

  // یک محصول ممکن است در چند خط باشد (واریانت‌های مختلف)؛ موجودی هر ردیف جدا چک می‌شود
  const shortages: {
    name: string;
    requested: number;
    available: number;
    unavailable?: boolean;
  }[] = [];
  for (const item of cart) {
    const live = catalog.get(lineKey(item));
    if (!live) {
      shortages.push({
        name: item.name,
        requested: item.qty,
        available: 0,
        unavailable: true,
      });
    } else if (live.stock !== null && live.stock < item.qty) {
      shortages.push({
        name: item.name,
        requested: item.qty,
        available: Math.max(0, live.stock),
      });
    }
  }
  if (shortages.length > 0) return { status: 'OUT_OF_STOCK', shortages };

  const changes: { name: string; from: number; to: number }[] = [];
  const nextCart = cart.map((item) => {
    const live = catalog.get(lineKey(item))!;
    if (live.unitPrice !== item.unitPrice) {
      changes.push({
        name: item.name,
        from: item.unitPrice,
        to: live.unitPrice,
      });
      return { ...item, unitPrice: live.unitPrice };
    }
    return item;
  });
  if (changes.length > 0)
    return { status: 'PRICE_CHANGED', cart: nextCart, changes };
  return { status: 'OK' };
}
