-- افزودن سه ستون جدید به plans — فقط ADD COLUMN با مقدار پیش‌فرض، هیچ داده‌ی موجودی تغییر نمی‌کند.
-- ریسک این مایگریشن خیلی پایین است (بدون UPDATE روی داده‌ی موجود).

BEGIN;

ALTER TABLE "plans" ADD COLUMN "isPopular" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plans" ADD COLUMN "featuredModels" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "plans" ADD COLUMN "featuredModelsCount" INTEGER NOT NULL DEFAULT 5;

COMMIT;

-- بعد از اجرا، از پنل ادمین (صفحه‌ی پلن‌ها) برای هر پلن:
--   ۱. سوییچ «محبوب‌ترین» را برای «پلاس» روشن کن.
--   ۲. چند مدل را به‌عنوان «مدل‌های ویژه» انتخاب کن (ترتیب انتخاب = ترتیب نمایش).
-- تا زمانی که این‌ها را تنظیم نکنی، رفتار فعلی (fallback به allowedModels) بدون تغییر باقی می‌ماند.
