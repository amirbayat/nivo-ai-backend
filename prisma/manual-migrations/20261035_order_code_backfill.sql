-- docs/PRD-nivo-sales-unified.md فاز ۳ (تسک 3.3، 3.4، 3.10) — قدم ۳ از ۳
-- backfill داده‌ی سفارش‌های موجود. idempotent و قابل اجرای مجدد (فقط ردیف‌های خالی را پر می‌کند).
-- باید بعد از 20261034_order_lifecycle.sql اجرا شود. هر زمان بعد از دیپلوی هم می‌توان دوباره اجرا کرد.

-- ۱) کد سفارش: NV + ۶ نویسه از الفبای ۳۱تایی بدون 0 O 1 I L؛ تصادفی؛ retry روی برخورد unique
CREATE OR REPLACE FUNCTION pg_temp.nv_order_code() RETURNS text AS $$
DECLARE
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  code text := 'NV';
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(alphabet, 1 + floor(random() * 31)::int, 1);
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  r RECORD;
  attempt int;
BEGIN
  FOR r IN SELECT id FROM "orders" WHERE "orderCode" IS NULL ORDER BY "createdAt" LOOP
    attempt := 0;
    LOOP
      BEGIN
        UPDATE "orders" SET "orderCode" = pg_temp.nv_order_code() WHERE id = r.id AND "orderCode" IS NULL;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempt := attempt + 1;
        IF attempt >= 10 THEN RAISE; END IF;
      END;
    END LOOP;
  END LOOP;
END $$;

-- ۲) تاریخچه‌ی وضعیت: برای هر سفارش بدون هیچ رویدادی، از زمان‌های موجود رکورد ساخته می‌شود
INSERT INTO "order_status_events" ("id", "orderId", "from", "to", "actor", "reason", "createdAt")
SELECT gen_random_uuid()::text, o.id, NULL, 'PENDING_PAYMENT', 'SYSTEM', 'backfill', o."createdAt"
FROM "orders" o
WHERE NOT EXISTS (SELECT 1 FROM "order_status_events" e WHERE e."orderId" = o.id);

INSERT INTO "order_status_events" ("id", "orderId", "from", "to", "actor", "reason", "createdAt")
SELECT gen_random_uuid()::text, o.id, 'PENDING_PAYMENT', 'APPROVED', 'SELLER', 'backfill', o."approvedAt"
FROM "orders" o
WHERE o."approvedAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "order_status_events" e WHERE e."orderId" = o.id AND e."to" = 'APPROVED');

INSERT INTO "order_status_events" ("id", "orderId", "from", "to", "actor", "reason", "createdAt")
SELECT gen_random_uuid()::text, o.id, 'APPROVED', 'SHIPPED', 'SELLER', 'backfill', o."shippedAt"
FROM "orders" o
WHERE o."shippedAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "order_status_events" e WHERE e."orderId" = o.id AND e."to" = 'SHIPPED');

INSERT INTO "order_status_events" ("id", "orderId", "from", "to", "actor", "reason", "createdAt")
SELECT gen_random_uuid()::text, o.id, 'PENDING_PAYMENT', 'REJECTED', 'SELLER', 'backfill', o."rejectedAt"
FROM "orders" o
WHERE o."rejectedAt" IS NOT NULL AND o.status = 'REJECTED'
  AND NOT EXISTS (SELECT 1 FROM "order_status_events" e WHERE e."orderId" = o.id AND e."to" = 'REJECTED');

-- ۳) مهلت پرداخت سفارش‌های پرداخت‌نشده‌ی موجود: createdAt+۲۴ساعت، ولی حداقل یک ساعت از الان
-- (cron انقضا بعد از آن لغوشان می‌کند؛ برای سفارش‌های قدیمی بی‌صدا، بدون پیام به خریدار)
UPDATE "orders"
SET "paymentDueAt" = GREATEST("createdAt" + interval '24 hours', now() + interval '1 hour')
WHERE status = 'PENDING_PAYMENT' AND "paymentDueAt" IS NULL;
