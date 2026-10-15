import { Prisma } from '@prisma/client';

// 0.3 — کمبود موجودی هنگام تایید سفارش (به فروشنده هشدار داده می‌شود، نه clamp بی‌صدا)
export type StockShortage = {
  name: string;
  requested: number;
  available: number;
};

// فیدبک کاربر ۱۴۰۵/۰۷/۲۱ — کسر موجودی فقط روی تایید فروشنده (نه لحظه‌ی ساخت سفارش) و برگشت
// فقط وقتی سفارش تاییدشده رد/لغو شود. آیتم با variantId از موجودی همان ترکیب کم می‌شود، وگرنه
// از خود محصول؛ موجودی هیچ‌وقت منفی نمی‌شود (اگر کمتر از qty مانده بود، صفر می‌شود و کمبود
// برگردانده می‌شود). تنها مسیر تغییر موجودی سفارش: OrderStateService (3.2)
export async function adjustOrderStock(
  db: Prisma.TransactionClient,
  items: Prisma.JsonValue,
  direction: 'DEDUCT' | 'RESTORE',
): Promise<StockShortage[]> {
  const shortages: StockShortage[] = [];
  for (const item of items as {
    productId: string;
    name?: string;
    variantId?: string;
    qty: number;
  }[]) {
    if (!(item.qty > 0)) continue;
    // SP-3 — «همیشه موجود»: نه کسر، نه بازگشت، و هرگز کمبود گزارش نمی‌شود
    const tracking = await db.product.findUnique({
      where: { id: item.productId },
      select: { trackStock: true },
    });
    if (tracking && tracking.trackStock === false) continue;
    const delegate = item.variantId ? db.productVariant : db.product;
    const where = item.variantId
      ? { id: item.variantId, productId: item.productId }
      : { id: item.productId };
    if (direction === 'RESTORE') {
      await (delegate as typeof db.product).updateMany({
        where,
        data: { stock: { increment: item.qty } },
      });
      continue;
    }
    const { count } = await (delegate as typeof db.product).updateMany({
      where: { ...where, stock: { gte: item.qty } },
      data: { stock: { decrement: item.qty } },
    });
    if (count === 0) {
      // 0.3 — clamp می‌ماند (تایید فروشنده مسدود نمی‌شود، چون ممکن است موجودی فیزیکی هست و
      // فقط عدد سیستم عقب است) ولی کمبود به فروشنده هشدار داده می‌شود
      const live = await (delegate as typeof db.product).findFirst({
        where,
        select: { stock: true },
      });
      await (delegate as typeof db.product).updateMany({
        where,
        data: { stock: 0 },
      });
      shortages.push({
        name: item.name ?? '',
        requested: item.qty,
        available: Math.max(0, live?.stock ?? 0),
      });
    }
  }
  return shortages;
}
