-- R1.2: AI kill switch and store suspension reason. Additive, nullable or defaulted. Safe before deploy.
ALTER TABLE "sales_agent_global_config" ADD COLUMN IF NOT EXISTS "aiEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "suspendedReason" TEXT;

-- Verify (expect 2 rows):
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE (table_name = 'sales_agent_global_config' AND column_name = 'aiEnabled')
--    OR (table_name = 'stores' AND column_name = 'suspendedReason');
