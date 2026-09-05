-- CreateEnum
CREATE TYPE "PricingGenerationType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "video_studio_config" ALTER COLUMN "maxConcurrentVideoJobsPerUser" SET DEFAULT 4;

-- AlterTable
ALTER TABLE "studio_projects" ADD COLUMN     "videoDurationSec" INTEGER;

-- AlterTable
ALTER TABLE "studio_shots" ADD COLUMN     "notificationSeenAt" TIMESTAMP(3),
ADD COLUMN     "videoCompletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "pricing_tiers" (
    "id" TEXT NOT NULL,
    "type" "PricingGenerationType" NOT NULL,
    "minToman" INTEGER NOT NULL,
    "maxToman" INTEGER,
    "markup" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pricing_tiers_type_minToman_idx" ON "pricing_tiers"("type", "minToman");

-- Data: پله‌ی پیش‌فرض بدون‌سقف برای هر نوع (متن ۱.۵ / عکس ۱.۲ / ویدیو ۱.۱) — از ادمین قابل ویرایش/افزودن پله
INSERT INTO "pricing_tiers" ("id", "type", "minToman", "maxToman", "markup", "createdAt", "updatedAt") VALUES
  ('pricing-tier-text-default', 'TEXT', 0, NULL, 1.5, now(), now()),
  ('pricing-tier-image-default', 'IMAGE', 0, NULL, 1.2, now(), now()),
  ('pricing-tier-video-default', 'VIDEO', 0, NULL, 1.1, now(), now())
ON CONFLICT ("id") DO NOTHING;

-- Data: سینگلتون تنظیمات ویدیو استودیو از قبل روی پروداکشن وجود دارد؛ تغییر @default ستون روی
-- ردیف موجود اثر نمی‌کند، پس مقدار فعلی (۲) را هم صریحاً به ۴ می‌بریم
UPDATE "video_studio_config" SET "maxConcurrentVideoJobsPerUser" = 4 WHERE "maxConcurrentVideoJobsPerUser" = 2;

