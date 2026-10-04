-- AlterTable
ALTER TABLE "store_discount_codes" ADD COLUMN     "productId" TEXT;

-- AddForeignKey
ALTER TABLE "store_discount_codes" ADD CONSTRAINT "store_discount_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

