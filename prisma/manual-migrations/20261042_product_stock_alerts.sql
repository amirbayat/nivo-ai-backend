CREATE TABLE IF NOT EXISTS "product_stock_alerts" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "customerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "product_stock_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "product_stock_alerts_storeId_notifiedAt_idx"
  ON "product_stock_alerts"("storeId", "notifiedAt");
CREATE INDEX IF NOT EXISTS "product_stock_alerts_productId_notifiedAt_idx"
  ON "product_stock_alerts"("productId", "notifiedAt");

DO $$ BEGIN
  ALTER TABLE "product_stock_alerts"
    ADD CONSTRAINT "product_stock_alerts_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "product_stock_alerts"
    ADD CONSTRAINT "product_stock_alerts_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "product_stock_alerts"
    ADD CONSTRAINT "product_stock_alerts_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "product_stock_alerts"
    ADD CONSTRAINT "product_stock_alerts_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
