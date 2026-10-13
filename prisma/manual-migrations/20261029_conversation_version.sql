-- docs/PRD-nivo-sales-unified.md تسک 0.4 — قفل خوش‌بینانه‌ی مکالمه (additive، idempotent)
ALTER TABLE "sales_conversations" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
