-- docs/PRD-nivo-sales-unified.md فاز ۱ (تسک 1.1، مشخصات ج ۲۳.۱) — قدم ۲ از ۳
-- بخش‌بندی اعتبار فروشگاه به‌ازای منبع (درگاه). فقط افزودن؛ هیچ DROP/تغییر نوعی ندارد و
-- idempotent است (دوبار اجرا هم خطا نمی‌دهد). باید بعد از 20261030_credit_buckets_enum.sql اجرا شود.

DO $$ BEGIN
  CREATE TYPE "CreditSource" AS ENUM ('ZIBAL', 'ZARINPAL', 'VANDAR', 'BAZAAR', 'SNAPPPAY', 'ADMIN_MANUAL', 'LEGACY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "credit_usage_events"
  ADD COLUMN IF NOT EXISTS "chargeBreakdown" JSONB,
  ADD COLUMN IF NOT EXISTS "source" "CreditSource";

CREATE TABLE IF NOT EXISTS "store_credit_buckets" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "source" "CreditSource" NOT NULL,
    "balanceToman" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_credit_buckets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "credit_source_markups" (
    "source" "CreditSource" NOT NULL,
    "buyerMarkup" DOUBLE PRECISION,
    "sellerMarkup" DOUBLE PRECISION,
    "enabledForPurchase" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,
    CONSTRAINT "credit_source_markups_pkey" PRIMARY KEY ("source")
);

CREATE TABLE IF NOT EXISTS "credit_source_markup_history" (
    "id" TEXT NOT NULL,
    "source" "CreditSource" NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "adminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_source_markup_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "store_credit_buckets_storeId_source_key"
  ON "store_credit_buckets"("storeId", "source");
CREATE INDEX IF NOT EXISTS "credit_source_markup_history_source_createdAt_idx"
  ON "credit_source_markup_history"("source", "createdAt");

DO $$ BEGIN
  ALTER TABLE "store_credit_buckets"
    ADD CONSTRAINT "store_credit_buckets_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- seed ضرایب: همه null (= ارث از SalesAgentGlobalConfig، یعنی رفتار امروز) به‌جز SNAPPPAY
-- (۲٫۵ و ۱٫۸۷۵، هنوز برای خرید خاموش). enabledForPurchase فقط برای درگاه‌های واقعی خرید اعتبار
-- فروشگاه (زیبال/زرین‌پال/وندار) true است؛ BAZAAR (فقط اپ نیوو کال)، ADMIN_MANUAL و LEGACY
-- درگاه نیستند. ON CONFLICT DO NOTHING: دوباره اجرا کردن ضرایبی را که ادمین عوض کرده بازنویسی نمی‌کند.
INSERT INTO "credit_source_markups" ("source", "buyerMarkup", "sellerMarkup", "enabledForPurchase", "updatedAt") VALUES
  ('ZIBAL', NULL, NULL, true, now()),
  ('ZARINPAL', NULL, NULL, true, now()),
  ('VANDAR', NULL, NULL, true, now()),
  ('BAZAAR', NULL, NULL, false, now()),
  ('SNAPPPAY', 2.5, 1.875, false, now()),
  ('ADMIN_MANUAL', NULL, NULL, false, now()),
  ('LEGACY', NULL, NULL, false, now())
ON CONFLICT ("source") DO NOTHING;
