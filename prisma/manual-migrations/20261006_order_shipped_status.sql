-- docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۳ — ارسال سفارش (فاز ۶)
-- additive، بدون data loss: مقدار SHIPPED به enum OrderStatus اضافه می‌شود (سفارش‌های قدیمی
-- دست‌نخورده می‌مانند)، shippedAt هم nullable است (پیش‌فرض null یعنی هنوز ارسال نشده).
-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'SHIPPED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shippedAt" TIMESTAMP(3);
