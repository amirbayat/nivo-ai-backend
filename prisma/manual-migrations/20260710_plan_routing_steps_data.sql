-- داده‌ی استپ‌های مسیریابی مدل بر اساس درصد مصرف روزانه (پلن‌های اکو/پلاس) — فقط INSERT.
-- منبع: back-end/prisma/seeds/plans.seed.ts (همان مقادیری که قبلاً برای لوکال مشخص شده بود).
--
-- پیش‌نیاز: باید prisma/manual-migrations/20260709_plan_routing_steps.sql از قبل روی این
-- دیتابیس اجرا شده باشد (یعنی جدول "plan_routing_steps" و ستون plans."simpleModel" موجود باشند).
-- اگر آن migration هنوز روی پروداکشن اجرا نشده، اول آن را اجرا کن، بعد این فایل را.
--
-- توجه به نام‌گذاری پلن‌ها: seed از نام «اکو»/«پلاس» استفاده می‌کند، اما دیتابیس واقعی
-- (لوکال، و به‌احتمال زیاد پروداکشن هم همینطور) هنوز نام قدیمی «نقره‌ای»/«طلایی» را دارد —
-- ریبرندینگ فقط در فرانت (front-end/src/locales/fa.ts: silver→اکو, gold→پلاس) اعمال شده،
-- نه در ستون plans.name. برای همین این INSERT روی نام match نمی‌کند، روی sortOrder
-- (که هر دو دیتابیس مشترکاً دارند: ۱=تیر اکو/نقره‌ای، ۲=تیر پلاس/طلایی) match می‌کند.
--
-- ایمن برای اجرای دوباره: با ON CONFLICT DO NOTHING روی (planId, order) — اگر ردیفی از قبل
-- (مثلاً دستی از پنل ادمین) وجود داشته باشد دست نمی‌خورد.

BEGIN;

INSERT INTO "plan_routing_steps" ("id", "planId", "order", "thresholdPct", "models", "updatedAt")
SELECT gen_random_uuid()::text, p."id", s."order", s."thresholdPct", s."models"::jsonb, CURRENT_TIMESTAMP
FROM "plans" p
JOIN (VALUES
  (1,  1,  60, '["openai/gpt-5-mini","google/gemini-2.5-flash"]'),
  (1,  2,  90, '["openai/gpt-5-nano","google/gemini-3.1-flash-lite","google/gemini-2.5-flash-lite"]'),
  (1,  3, 100, '["openai/gpt-5-nano"]'),
  (2,  1,  70, '["openai/gpt-5.4-mini","openai/gpt-5.1-codex-mini","openai/o4-mini","openai/o4-mini-high","google/gemini-3-flash-preview","google/gemini-2.5-flash","x-ai/grok-4.3","x-ai/grok-4.20"]'),
  (2,  2,  90, '["openai/gpt-5.4-nano","openai/gpt-5-mini","openai/gpt-4.1-mini","google/gemini-3.1-flash-lite"]'),
  (2,  3, 100, '["openai/gpt-5-nano","openai/gpt-4o-mini","google/gemini-2.5-flash-lite","deepseek/deepseek-v4-pro","deepseek/deepseek-v4-flash"]')
) AS s("planSortOrder", "order", "thresholdPct", "models")
  ON p."sortOrder" = s."planSortOrder"
ON CONFLICT ("planId", "order") DO NOTHING;

COMMIT;
