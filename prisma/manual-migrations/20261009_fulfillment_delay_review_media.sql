-- AlterTable
ALTER TABLE "products" ADD COLUMN     "hasFulfillmentDelay" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "hasFulfillmentDelay" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "product_comments" ALTER COLUMN "text" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "orders_status_hasFulfillmentDelay_shippedAt_idx" ON "orders"("status", "hasFulfillmentDelay", "shippedAt");

