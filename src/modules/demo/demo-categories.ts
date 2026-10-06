// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۵.۲، ۱۸ فاز ۲ — نگاشت اسلاگ
// انگلیسی لینک دمو (nivoai.ir/demo/seller/<slug>) به همان برچسب فارسی BUSINESS_CATEGORIES
// (business-categories.ts). فقط ۱۳ دسته‌ی کالا (PRODUCT_SALES) — ۴ دسته‌ی خدماتی/نوبت‌دهی
// (پزشکی، مشاوره، آرایشگاه، آموزش خصوصی) و «سایر» عمداً حذف شدند چون مدل دموی فعلی (کپی
// محصول) برای businessType=APPOINTMENT_BOOKING که هنوز مدل داده‌اش ساخته نشده معنا ندارد.
export const DEMO_CATEGORY_SLUGS = {
  clothing: 'پوشاک',
  'bags-shoes': 'کیف و کفش',
  cosmetics: 'آرایشی و بهداشتی',
  'home-kitchen': 'خانه و آشپزخانه',
  digital: 'دیجیتال و لوازم جانبی',
  food: 'خوراکی و صنایع غذایی',
  'kids-baby': 'کودک و نوزاد',
  'sports-travel': 'ورزش و سفر',
  jewelry: 'جواهرات و اکسسوری',
  'books-stationery': 'کتاب و لوازم‌التحریر',
  'flowers-plants': 'گل و گیاه',
  handicrafts: 'صنایع‌دستی',
  pets: 'حیوانات خانگی',
} as const;

export type DemoCategorySlug = keyof typeof DEMO_CATEGORY_SLUGS;

export function isDemoCategorySlug(value: string): value is DemoCategorySlug {
  return Object.prototype.hasOwnProperty.call(DEMO_CATEGORY_SLUGS, value);
}
