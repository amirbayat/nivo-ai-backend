-- docs/PRD-seller-advertising-placements.md — جایگاه تبلیغاتی/Boost فروشگاه در جستجوی تلگرام
-- (بخش ۱۳ نقشه‌ی راه)؛ کاملاً additive — جدول جدید + یک مقدار جدید روی enum موجود، بدون
-- drop/تغییر نوع هیچ ستونی
-- CreateEnum
CREATE TYPE "AdPlacementType" AS ENUM ('TELEGRAM_STORE_SEARCH', 'MARKETPLACE_FEATURED');

-- CreateEnum
CREATE TYPE "AdPlacementStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "CreditUsageKind" ADD VALUE 'AD_PLACEMENT';

-- CreateTable
CREATE TABLE "ad_placements" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "placement" "AdPlacementType" NOT NULL DEFAULT 'TELEGRAM_STORE_SEARCH',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "priceToman" INTEGER NOT NULL,
    "status" "AdPlacementStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_placements_placement_status_startsAt_endsAt_idx" ON "ad_placements"("placement", "status", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

