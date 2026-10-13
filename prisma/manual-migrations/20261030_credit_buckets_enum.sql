-- docs/PRD-nivo-sales-unified.md فاز ۱ (تسک 1.1) — قدم ۱ از ۳: فقط افزودن مقدار enum
-- (ALTER TYPE ... ADD VALUE باید جدا و قبل از فایل اصلی اجرا شود؛ additive و idempotent)
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'SNAPPPAY';
