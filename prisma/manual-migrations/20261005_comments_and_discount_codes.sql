-- docs/PRD-customer-comments-and-discounts.md — نظرات خریداران با تایید ادمین + کد تخفیف
-- فروشگاهی (additive, safe)

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('PENDING', 'AI_AUTO_REJECTED', 'ADMIN_APPROVED', 'ADMIN_REJECTED');

-- CreateEnum
CREATE TYPE "DiscountKind" AS ENUM ('PERCENT', 'FIXED_AMOUNT');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discountCodeId" TEXT;

-- CreateTable
CREATE TABLE "product_comments" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT,
    "customerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rating" INTEGER,
    "status" "CommentStatus" NOT NULL DEFAULT 'PENDING',
    "aiVerdict" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_discount_codes" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "DiscountKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_comments_storeId_status_idx" ON "product_comments"("storeId", "status");

-- CreateIndex
CREATE INDEX "product_comments_productId_idx" ON "product_comments"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "store_discount_codes_storeId_code_key" ON "store_discount_codes"("storeId", "code");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "store_discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_comments" ADD CONSTRAINT "product_comments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_comments" ADD CONSTRAINT "product_comments_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_comments" ADD CONSTRAINT "product_comments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_discount_codes" ADD CONSTRAINT "store_discount_codes_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

