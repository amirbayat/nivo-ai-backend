-- docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۴ — سوئیچ فروشنده برای خاموش‌کردن
-- پیام‌های خودکار (دغدغه‌ی برند/اسپم). دو ستون جدید، هر دو NOT NULL با DEFAULT true تا
-- رفتار فروشگاه‌های موجود بدون تغییر بماند (پیام‌ها طبق قبل فعال باقی می‌مانند).

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "abandonedCartReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "postPurchaseFollowUpEnabled" BOOLEAN NOT NULL DEFAULT true;
