-- CreateEnum
CREATE TYPE "StoreKbKind" AS ENUM ('FAQ', 'POLICY', 'PRODUCT_INFO', 'GENERAL');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "store_kb_entries" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "StoreKbKind" NOT NULL DEFAULT 'FAQ',
    "relatedProductId" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "sourceFileKey" TEXT,
    "embedding" JSONB,
    "embeddingModel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_kb_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_kb_entries_storeId_isActive_idx" ON "store_kb_entries"("storeId", "isActive");

-- AddForeignKey
ALTER TABLE "store_kb_entries" ADD CONSTRAINT "store_kb_entries_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_kb_entries" ADD CONSTRAINT "store_kb_entries_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

