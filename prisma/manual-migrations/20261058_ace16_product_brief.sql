-- ACE-ITEM: ACE-16
-- ACE-ROLLBACK: rollback/20261058_ace16_product_brief.down.sql
-- ACE-SAFETY: additive — فقط CREATE TABLE/INDEX IF NOT EXISTS؛ کد بدون این SQL هم کار می‌کند
CREATE TABLE IF NOT EXISTS "product_brief" (
  "productId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "descHash" TEXT NOT NULL,
  "sections" JSONB NOT NULL,
  "brief" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_brief_pkey" PRIMARY KEY ("productId"),
  CONSTRAINT "product_brief_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "product_brief_storeId_idx" ON "product_brief"("storeId");
