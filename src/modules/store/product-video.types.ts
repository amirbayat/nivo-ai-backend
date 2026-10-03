// docs/PRD-product-video.md بخش ۴ — Product.videos یک ستون Json است (الگوی Order.items در
// همین کدبیس)، نه یک مدل رابطه‌ای جدا؛ این تایپ شکل هر عضو آرایه را مشخص می‌کند تا همه‌جا
// (store.service.ts، conversation-engine.service.ts، sales-agent.types.ts) یکسان باشد
export type ProductVideoItem = {
  key: string;
  durationSec: number;
};

// فیلد Product.videos نوعش Prisma.JsonValue است، نه ProductVideoItem[] — این تابع آن را
// امن parse می‌کند (ورودی ناقص/خراب را نادیده می‌گیرد به‌جای throw)
export function parseProductVideos(value: unknown): ProductVideoItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ProductVideoItem =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as ProductVideoItem).key === 'string' &&
      typeof (item as ProductVideoItem).durationSec === 'number',
  );
}
