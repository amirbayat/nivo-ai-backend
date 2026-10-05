-- docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲.۲ — اجرت/سود اختصاصی
-- هر محصول (فیدبک کاربر ۱۴۰۵/۰۷/۱۴)؛ additive، nullable = از تنظیمات پیش‌فرض فروشگاه استفاده کن.
-- پیش‌نیاز: migration قبلی همین فیچر (20261025_gold_weight_based_pricing.sql) که نوع
-- "GoldWageType" را می‌سازد، باید قبل از این فایل روی همان دیتابیس اجرا شده باشد.
ALTER TABLE "products" ADD COLUMN     "goldProfitPercent" DOUBLE PRECISION,
ADD COLUMN     "goldWageType" "GoldWageType",
ADD COLUMN     "goldWageValue" DOUBLE PRECISION;
