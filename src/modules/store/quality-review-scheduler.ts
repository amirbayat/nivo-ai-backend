// PQ-2 — نقطه‌ی تریگر بدون DI: StoreService و بقیه فقط scheduleProductReview(productId) را صدا می‌زنند؛
// هندلر واقعی را ProductQualityReviewService هنگام بوت ثبت می‌کند. بدون هندلر (تست) هیچ اتفاقی نمی‌افتد.
type Handler = (productId: string) => void;
let handler: Handler | null = null;

export function setQualityReviewHandler(h: Handler | null): void {
  handler = h;
}

export function scheduleProductReview(productId: string): void {
  try {
    if (productId) handler?.(productId);
  } catch {
    /* best-effort */
  }
}
