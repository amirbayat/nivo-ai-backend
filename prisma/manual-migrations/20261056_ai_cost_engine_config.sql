-- ACE: تنظیمات موتور هزینه (singleton). Additive و idempotent. تا اجرا نشود، پیش‌فرض‌های کد (همه off) اعمال می‌شوند.
CREATE TABLE IF NOT EXISTS "ai_cost_engine_config" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "layers" JSONB NOT NULL,
  "params" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_cost_engine_config_pkey" PRIMARY KEY ("id")
);
