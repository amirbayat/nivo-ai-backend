-- CreateTable
CREATE TABLE "saved_products" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_products_customerId_idx" ON "saved_products"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_products_customerId_productId_key" ON "saved_products"("customerId", "productId");

-- AddForeignKey
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_products" ADD CONSTRAINT "saved_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

