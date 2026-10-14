-- CreditUsageEvent.meta (nullable JSON). Safe to run before deploy.
-- Code writes {"isTest":true} only for seller test-chat usage.
ALTER TABLE "credit_usage_events" ADD COLUMN IF NOT EXISTS "meta" JSONB;
