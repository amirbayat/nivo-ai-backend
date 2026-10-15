-- Step 1 of 2 for the "tell me when it is back" unique index (run BEFORE 20261046b).
-- Removes duplicate OPEN alerts (notifiedAt IS NULL) for the same buyer, product and variant,
-- keeping the oldest row. Safe to run more than once. Notified rows are never touched.
DELETE FROM product_stock_alerts a
USING product_stock_alerts b
WHERE a."notifiedAt" IS NULL
  AND b."notifiedAt" IS NULL
  AND a."customerId" = b."customerId"
  AND a."productId" = b."productId"
  AND COALESCE(a."variantId", '') = COALESCE(b."variantId", '')
  AND (a."createdAt", a.id) > (b."createdAt", b.id);

-- Verify (expect 0 rows):
-- SELECT "customerId", "productId", COALESCE("variantId", '') AS variant, count(*)
-- FROM product_stock_alerts WHERE "notifiedAt" IS NULL
-- GROUP BY 1, 2, 3 HAVING count(*) > 1;
