-- docs/PRD-openrouter-migration.md §۱۴.۲/۱۴.۶ — شمارنده‌ی denormalized عکس هر گفتگو، برای
-- سقف توصیه‌ای استودیوی عکس (نه محدودیت سخت) + فیلتر «فقط گفتگوهای عکس» در تاریخچه بدون JOIN

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "imageGenCount" INTEGER NOT NULL DEFAULT 0;
