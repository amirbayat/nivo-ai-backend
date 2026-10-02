-- docs/PRD-sales-agent-persuasion-principles.md بخش ۶ — کلید خاموش/روشن ۶ اصل متقاعدسازی،
-- سطح فروشگاه و سطح محصول (AND هم). هر دو NOT NULL DEFAULT true چون محصولات/فروشگاه‌های
-- موجود همین الان بدون نیاز به اقدام فروشنده از این قابلیت بهره می‌برند.
-- نکته: این فایل مستقل از 20261012_full_agent_response_strategy.sql است — اگر آن یکی هنوز
-- روی پروداکشن اجرا نشده، باید قبل از این یکی اجرا شود (fkها/وابستگی مستقیم ندارند ولی
-- ترتیب تاریخ فایل‌ها همین توالی است).

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "persuasionTechniquesEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "persuasionTechniquesEnabled" BOOLEAN NOT NULL DEFAULT true;
