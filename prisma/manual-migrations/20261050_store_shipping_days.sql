-- R3.3: shipping days range on stores. Additive, nullable. Safe before deploy.
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "shippingDaysMin" INTEGER;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "shippingDaysMax" INTEGER;

-- Verify (expect 2 rows):
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'stores' AND column_name IN ('shippingDaysMin', 'shippingDaysMax');
