-- AlterTable
ALTER TABLE "credit_config" ALTER COLUMN "extractionEconomicalModel" SET DEFAULT 'openai/gpt-5.4-mini';

-- Backfill: فقط رکوردهایی که هنوز هیچ مدلی برای حالت cost_optimized انتخاب نشده (NULL)
-- را به دیفالت جدید می‌برد؛ انتخاب صریح ادمین (هر مقدار غیر NULL) دست‌نخورده می‌ماند.
UPDATE "credit_config" SET "extractionEconomicalModel" = 'openai/gpt-5.4-mini'
WHERE "extractionEconomicalModel" IS NULL;
