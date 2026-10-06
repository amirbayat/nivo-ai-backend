-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "clonedFromStoreId" TEXT,
ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isDemoTemplate" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "stores_isDemoTemplate_category_idx" ON "stores"("isDemoTemplate", "category");

-- CreateIndex
CREATE INDEX "stores_sellerId_isDemo_idx" ON "stores"("sellerId", "isDemo");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_clonedFromStoreId_fkey" FOREIGN KEY ("clonedFromStoreId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

