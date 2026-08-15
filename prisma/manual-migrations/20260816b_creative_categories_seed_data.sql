-- درخت اولیه‌ی دسته‌بندی دیسکاوری برای production — مستقل از seed اسکریپت ts-node (که فقط
-- محیط dev/docker اجرا می‌شود). امن برای اجرای مجدد: هر INSERT فقط وقتی رکورد هم‌نام (با همان
-- والد) وجود نداشته باشد اجرا می‌شود. بعد از اجرا، ادمین می‌تواند از /admin/creative-categories
-- ادامه‌ی درخت رو ویرایش/گسترش بده.

-- ── سطح ریشه ──────────────────────────────────────────────────────────────
INSERT INTO "creative_categories" ("id", "name", "parentId", "sortOrder", "isActive", "createdAt")
SELECT gen_random_uuid(), 'اینستاگرام', NULL, 0, true, now()
WHERE NOT EXISTS (SELECT 1 FROM "creative_categories" WHERE "name" = 'اینستاگرام' AND "parentId" IS NULL);

INSERT INTO "creative_categories" ("id", "name", "parentId", "sortOrder", "isActive", "createdAt")
SELECT gen_random_uuid(), 'یوتیوب', NULL, 1, true, now()
WHERE NOT EXISTS (SELECT 1 FROM "creative_categories" WHERE "name" = 'یوتیوب' AND "parentId" IS NULL);

INSERT INTO "creative_categories" ("id", "name", "parentId", "sortOrder", "isActive", "createdAt")
SELECT gen_random_uuid(), 'کسب‌وکار', NULL, 2, true, now()
WHERE NOT EXISTS (SELECT 1 FROM "creative_categories" WHERE "name" = 'کسب‌وکار' AND "parentId" IS NULL);

INSERT INTO "creative_categories" ("id", "name", "parentId", "sortOrder", "isActive", "createdAt")
SELECT gen_random_uuid(), 'عمومی', NULL, 3, true, now()
WHERE NOT EXISTS (SELECT 1 FROM "creative_categories" WHERE "name" = 'عمومی' AND "parentId" IS NULL);

-- ── زیرمجموعه‌ی «اینستاگرام» ──────────────────────────────────────────────
INSERT INTO "creative_categories" ("id", "name", "parentId", "sortOrder", "isActive", "createdAt")
SELECT gen_random_uuid(), v.name, p.id, v.sort, true, now()
FROM "creative_categories" p
CROSS JOIN (VALUES
  ('کاور پست اینستاگرام', 0),
  ('پست اسلایدی اینستاگرام', 1),
  ('کاور ریلز', 2),
  ('استوری اینستاگرام', 3)
) AS v(name, sort)
WHERE p."name" = 'اینستاگرام' AND p."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "creative_categories" c WHERE c."name" = v.name AND c."parentId" = p.id
  );

-- ── زیرمجموعه‌ی «یوتیوب» ──────────────────────────────────────────────────
INSERT INTO "creative_categories" ("id", "name", "parentId", "sortOrder", "isActive", "createdAt")
SELECT gen_random_uuid(), v.name, p.id, v.sort, true, now()
FROM "creative_categories" p
CROSS JOIN (VALUES
  ('تامبنیل یوتیوب', 0),
  ('کاور کانال یوتیوب', 1)
) AS v(name, sort)
WHERE p."name" = 'یوتیوب' AND p."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "creative_categories" c WHERE c."name" = v.name AND c."parentId" = p.id
  );

-- ── زیرمجموعه‌ی «کسب‌وکار» ────────────────────────────────────────────────
INSERT INTO "creative_categories" ("id", "name", "parentId", "sortOrder", "isActive", "createdAt")
SELECT gen_random_uuid(), v.name, p.id, v.sort, true, now()
FROM "creative_categories" p
CROSS JOIN (VALUES
  ('پوستر تبلیغاتی', 0),
  ('کارت ویزیت دیجیتال', 1),
  ('بنر وب‌سایت', 2)
) AS v(name, sort)
WHERE p."name" = 'کسب‌وکار' AND p."parentId" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "creative_categories" c WHERE c."name" = v.name AND c."parentId" = p.id
  );
