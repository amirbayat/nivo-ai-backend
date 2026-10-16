import { bumpVersions } from '../../common/ai-cost-engine/version-keys';
import { scheduleStoreReview } from './quality-review-scheduler';

// ACE-3 + SQ-2 — نقطه‌ی مشترک «محتوای فروشگاه عوض شد»: نسخه‌ی کش‌ها بالا می‌رود و بررسی کیفیت صف می‌شود.
// هر دو fire-and-forget و fail-safe؛ بعد از commit صدا زده شود.
export function onStoreContentChanged(storeId: string, opts: { kb?: boolean } = {}): void {
  void bumpVersions({ storeId, kb: opts.kb });
  scheduleStoreReview(storeId);
}
