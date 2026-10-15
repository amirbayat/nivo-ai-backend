-- SP-3: product status / trackStock / stockSetAt + store launchSharedAt + seller-bot connect token.
-- Additive and idempotent. MUST RUN BEFORE DEPLOYING the SP-3 code (it reads the new columns).

DO $$ BEGIN
  CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'HIDDEN', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "trackStock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stockSetAt" TIMESTAMP(3);

-- Existing rows: stock was written at creation. Only touches rows that are still NULL, so re-running is a no-op.
UPDATE "products" SET "stockSetAt" = "createdAt" WHERE "stockSetAt" IS NULL AND "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "products_storeId_status_idx" ON "products" ("storeId", "status");

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "launchSharedAt" TIMESTAMP(3);
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "sellerBotConnectToken" TEXT;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "sellerBotConnectTokenExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "stores_sellerBotConnectToken_key" ON "stores" ("sellerBotConnectToken");

-- Verify:
-- SELECT column_name FROM information_schema.columns WHERE table_name='products' AND column_name IN ('status','trackStock','stockSetAt'); -- 3 rows
-- SELECT column_name FROM information_schema.columns WHERE table_name='stores' AND column_name IN ('launchSharedAt','sellerBotConnectToken','sellerBotConnectTokenExpiresAt'); -- 3 rows
-- SELECT status, count(*) FROM products GROUP BY 1; -- everything ACTIVE
