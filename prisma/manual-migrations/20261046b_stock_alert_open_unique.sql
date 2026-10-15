-- Step 2 of 2 (run AFTER 20261046a_stock_alert_dedupe.sql).
-- Run this file on its own, outside a transaction (auto-commit mode):
-- CREATE/DROP INDEX CONCURRENTLY cannot run inside a transaction block.
--
-- A failed earlier attempt (duplicate rows) leaves an INVALID index behind, and
-- "IF NOT EXISTS" would then silently do nothing. So drop any previous copy first,
-- valid or not, and build it again. Re-running this file is therefore always safe.
DROP INDEX CONCURRENTLY IF EXISTS product_stock_alerts_open_unique;

-- One open "tell me when it is back" row per buyer, product, and variant.
CREATE UNIQUE INDEX CONCURRENTLY product_stock_alerts_open_unique
ON product_stock_alerts ("customerId", "productId", (COALESCE("variantId", '')))
WHERE "notifiedAt" IS NULL;

-- Verify (expect indisvalid = true):
-- SELECT indisvalid FROM pg_index WHERE indexrelid = 'product_stock_alerts_open_unique'::regclass;
