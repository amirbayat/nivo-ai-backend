-- docs/PRD-seller-guide-assistant-modal.md بخش ۱.۵ — چهار تغییر additive برای دستیار راهنمای پرامپت (فاز ۱، MVP):
-- یادداشت خام فروشنده (ownerNotes)، لاگ تغییرات محتوا، زمان‌بندی تایید/رد سفارش، و
-- مقدار تازه‌ی enum برای صورت‌حساب تحلیل یادداشت. additive محض، تولیدشده با prisma migrate diff.

-- CreateEnum
CREATE TYPE "ContentChangeSource" AS ENUM ('MANUAL', 'AI_ENRICHMENT');

-- CreateEnum
CREATE TYPE "ContentEntityType" AS ENUM ('STORE', 'PRODUCT', 'KB_ENTRY', 'SHIPPING_RULE');

-- AlterEnum
ALTER TYPE "CreditUsageKind" ADD VALUE 'NOTES_ANALYSIS';

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "ownerNotes" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "ownerNotes" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "content_change_logs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "entityType" "ContentEntityType" NOT NULL,
    "entityId" TEXT,
    "fieldName" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" "ContentChangeSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_change_logs_storeId_entityType_entityId_createdAt_idx" ON "content_change_logs"("storeId", "entityType", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "content_change_logs" ADD CONSTRAINT "content_change_logs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

