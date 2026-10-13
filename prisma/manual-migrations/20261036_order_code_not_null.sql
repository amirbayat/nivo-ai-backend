-- docs/PRD-nivo-sales-unified.md فاز ۳ (تسک 3.1) — اختیاری و فقط «بعد از دیپلوی کد گام ۳»
-- هنگام اجرای این فایل باید هیچ سفارش بدون کد وجود نداشته باشد. اگر قبل از دیپلوی اجرا شود،
-- کد قدیمی (که کد نمی‌سازد) ثبت سفارش را می‌شکند؛ پس فقط بعد از دیپلوی.
-- اول backfill را دوباره اجرا کن (20261035_order_code_backfill.sql)، بعد:

SELECT count(*) AS orders_without_code FROM "orders" WHERE "orderCode" IS NULL;  -- باید 0 باشد

ALTER TABLE "orders" ALTER COLUMN "orderCode" SET NOT NULL;
