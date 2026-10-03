-- AlterEnum
ALTER TYPE "ConversationState" ADD VALUE 'ADDRESS_COLLECTION';

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "requiresShipping" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "addressId" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "receiptExtractedAmountToman" INTEGER,
ADD COLUMN     "receiptVerifiedMatch" BOOLEAN,
ADD COLUMN     "recipientName" TEXT,
ADD COLUMN     "recipientPhone" TEXT,
ADD COLUMN     "shippingAddress" TEXT,
ADD COLUMN     "shippingCity" TEXT,
ADD COLUMN     "shippingCostToman" INTEGER;

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "postalCode" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_shipping_rules" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "city" TEXT,
    "cost" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_shipping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");

-- CreateIndex
CREATE INDEX "store_shipping_rules_storeId_idx" ON "store_shipping_rules"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "store_shipping_rules_storeId_city_key" ON "store_shipping_rules"("storeId", "city");

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_shipping_rules" ADD CONSTRAINT "store_shipping_rules_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

