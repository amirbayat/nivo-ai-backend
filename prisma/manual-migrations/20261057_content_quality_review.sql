-- PQ-2 / SQ-2: جدول بررسی کیفیت توضیحات. Additive و idempotent.
-- تا اجرا نشود، endpoint فقط لایه‌ی قاعده‌ای (rules_only) را برمی‌گرداند و خطا نمی‌دهد.
DO $$ BEGIN
  CREATE TYPE "QualityReviewEntity" AS ENUM ('PRODUCT', 'STORE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "content_quality_review" (
  "id" TEXT NOT NULL,
  "entityType" "QualityReviewEntity" NOT NULL,
  "entityId" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "review" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_quality_review_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "content_quality_review_entityType_entityId_key" ON "content_quality_review"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "content_quality_review_storeId_idx" ON "content_quality_review"("storeId");
