-- Run this file on its own, outside a transaction.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- One open "tell me when it is back" row per buyer, product, and variant.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS product_stock_alerts_open_unique
ON product_stock_alerts ("customerId", "productId", (COALESCE("variantId", '')))
WHERE "notifiedAt" IS NULL;
