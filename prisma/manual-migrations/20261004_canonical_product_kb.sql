-- docs/PRD-seller-knowledge-base.md بخش ۲.۴ — پایگاه دانش مشترک محصولات بین فروشگاه‌ها
-- (CanonicalProduct، additive, safe)

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "canonicalProductId" TEXT;

-- CreateTable
CREATE TABLE "canonical_products" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "richDescription" TEXT NOT NULL,
    "specs" JSONB,
    "sourceCount" INTEGER NOT NULL DEFAULT 1,
    "lastEnrichedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canonical_products_normalizedName_idx" ON "canonical_products"("normalizedName");

-- CreateIndex
CREATE INDEX "products_canonicalProductId_idx" ON "products"("canonicalProductId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "canonical_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

