-- SP-2 §4.11.5: terms acceptance recorded when a store is created. Additive, nullable.
-- Safe before deploy (the code writes these columns best-effort and ignores a failure).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termsVersion" TEXT;

-- Verify (expect 2 rows):
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'users' AND column_name IN ('termsAcceptedAt', 'termsVersion');
