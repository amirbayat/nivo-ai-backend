-- CreateEnum
CREATE TYPE "ProductEnrichmentSource" AS ENUM ('ADMIN_RESOURCE', 'WEB_SEARCH');

-- CreateEnum
CREATE TYPE "ProductEnrichmentStatus" AS ENUM ('PENDING_ADMIN_REVIEW', 'PENDING_SELLER_REVIEW', 'SELLER_APPROVED', 'SELLER_REJECTED', 'ADMIN_REJECTED');

-- CreateTable
CREATE TABLE "product_enrichment_drafts" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "ProductEnrichmentStatus" NOT NULL DEFAULT 'PENDING_ADMIN_REVIEW',
    "source" "ProductEnrichmentSource" NOT NULL,
    "adminResourceText" TEXT,
    "suggestedDescription" TEXT NOT NULL,
    "suggestedQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suggestedSpecs" JSONB,
    "sourceNote" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminReviewedAt" TIMESTAMP(3),
    "sellerDecidedAt" TIMESTAMP(3),

    CONSTRAINT "product_enrichment_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_enrichment_drafts_productId_idx" ON "product_enrichment_drafts"("productId");

-- CreateIndex
CREATE INDEX "product_enrichment_drafts_status_idx" ON "product_enrichment_drafts"("status");

-- AddForeignKey
ALTER TABLE "product_enrichment_drafts" ADD CONSTRAINT "product_enrichment_drafts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

