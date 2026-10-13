-- Step 5 (4.13 + extra receipt images). Run after 20261037_receipt_check_enum.sql.
-- Additive and idempotent. No DROP.

ALTER TABLE "sales_agent_global_config"
  ADD COLUMN IF NOT EXISTS "orderPublicLinkEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "receiptImageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "short_links" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "short_links_code_key" ON "short_links"("code");
CREATE INDEX IF NOT EXISTS "short_links_orderId_idx" ON "short_links"("orderId");

DO $$ BEGIN
  ALTER TABLE "short_links"
    ADD CONSTRAINT "short_links_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
