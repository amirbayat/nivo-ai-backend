-- AlterEnum
ALTER TYPE "AdPlacementType" ADD VALUE 'GREETING_FEATURED_PRODUCT';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "telegramShortCode" TEXT;

-- AlterTable
ALTER TABLE "ad_placements" ADD COLUMN     "productId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "products_telegramShortCode_key" ON "products"("telegramShortCode");

-- CreateIndex
CREATE INDEX "ad_placements_productId_idx" ON "ad_placements"("productId");

-- AddForeignKey
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

