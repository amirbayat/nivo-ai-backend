-- docs/PRD-product-video.md بخش ۴ — Product.videoKey/videoDurationSec (تک‌مقداری) جایگزین
-- می‌شوند با Product.videos (آرایه‌ی JSON، [{ key, durationSec }])، چون فیدبک کاربر
-- ۱۴۰۵/۰۷/۱۲ چندویدیویی‌شدن محصول را خواست.
--
-- برخلاف خروجی خام `prisma migrate diff` (که فقط DROP+ADD می‌دهد و ویدیوهای فعلی محصولات را
-- گم می‌کند)، این نسخه‌ی دستی قبل از حذف ستون‌های قدیمی، مقدارشان را به عضو اول آرایه‌ی تازه
-- کپی می‌کند.

-- ۱) ستون جدید با مقدار پیش‌فرض آرایه‌ی خالی
ALTER TABLE "products" ADD COLUMN "videos" JSONB NOT NULL DEFAULT '[]';

-- ۲) بک‌فیل: هر محصولی که از قبل videoKey داشت، آن را به یک آرایه‌ی تک‌عضوی تبدیل کن
UPDATE "products"
SET "videos" = jsonb_build_array(
  jsonb_build_object('key', "videoKey", 'durationSec', COALESCE("videoDurationSec", 0))
)
WHERE "videoKey" IS NOT NULL;

-- ۳) حذف ستون‌های قدیمی تک‌مقداری
ALTER TABLE "products" DROP COLUMN "videoDurationSec",
DROP COLUMN "videoKey";
