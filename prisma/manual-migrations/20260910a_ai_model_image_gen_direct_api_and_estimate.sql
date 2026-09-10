-- docs/PRD-image-gen-pricing-and-credit-fix.md بخش C
-- فایل migration قبلی 20260903a_ai_model_flat_image_pricing.sql خراب است (۲ بایت بی‌معنی) —
-- معلوم نیست imageGenFlatPriceUsd/imageGenFlatPriceUnit روی DB پروداکشن واقعی وجود دارند یا نه.
-- این فایل idempotent است (IF NOT EXISTS) و صرف‌نظر از وضعیت فعلی امن برای اجراست.
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "imageGenFlatPriceUsd" DOUBLE PRECISION;
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "imageGenFlatPriceUnit" TEXT;
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "imageGenUseDirectApi" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "estimatedImageGenCreditCost" DOUBLE PRECISION;
