// PQ-2 — نقطه‌ی تریگر بدون DI: StoreService و بقیه فقط scheduleProductReview(productId) را صدا می‌زنند؛
// هندلر واقعی را ProductQualityReviewService هنگام بوت ثبت می‌کند. بدون هندلر (تست) هیچ اتفاقی نمی‌افتد.
type Handler = (productId: string) => void;
let handler: Handler | null = null;

export function setQualityReviewHandler(h: Handler | null): void {
  handler = h;
}

// ACE-16 — ساخت برگه‌ی محصول با همان trigger (call جدا، debounce جدا)
let briefHandler: Handler | null = null;

export function setProductBriefHandler(h: Handler | null): void {
  briefHandler = h;
}

export function scheduleProductReview(productId: string): void {
  try {
    if (productId) handler?.(productId);
  } catch {
    /* best-effort */
  }
  try {
    if (productId) briefHandler?.(productId);
  } catch {
    /* best-effort */
  }
}

// SQ-2 — همان الگو برای بررسی فروشگاه (jobId=store:{storeId})
let storeHandler: Handler | null = null;

export function setStoreQualityReviewHandler(h: Handler | null): void {
  storeHandler = h;
}

// helper مشترک تغییر محتوای فروشگاه (کنار bumpVersions ACE-3)
export function scheduleStoreReview(storeId: string): void {
  try {
    if (storeId) storeHandler?.(storeId);
  } catch {
    /* best-effort */
  }
}
