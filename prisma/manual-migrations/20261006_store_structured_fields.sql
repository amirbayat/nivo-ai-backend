-- docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — فیلدهای ساختاریافته‌ی سطح فروشگاه
-- (ارسال/مرجوعی/معرفی برند/ساعت پاسخ‌گویی)؛ کاملاً additive، بدون drop/تغییر نوع
-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "brandIntro" TEXT,
ADD COLUMN     "returnPolicy" TEXT,
ADD COLUMN     "shippingInfo" TEXT,
ADD COLUMN     "workingHoursEnd" TEXT,
ADD COLUMN     "workingHoursStart" TEXT;

