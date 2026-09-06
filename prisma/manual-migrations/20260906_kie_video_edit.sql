-- CreateEnum
CREATE TYPE "KieVideoCategory" AS ENUM ('GENERATE', 'EDIT', 'UPSCALE', 'LIPSYNC', 'DUBBING', 'MOTION_TRANSFER', 'EXTEND', 'OTHER');

-- CreateEnum
CREATE TYPE "VideoEditMode" AS ENUM ('GENERATE', 'EDIT');

-- CreateEnum
CREATE TYPE "VideoJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "kie_video_models" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" "KieVideoCategory" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "supportsImages" BOOLEAN NOT NULL DEFAULT false,
    "maxImages" INTEGER,
    "supportsVideo" BOOLEAN NOT NULL DEFAULT false,
    "maxVideoDurationSec" INTEGER,
    "maxVideoWindowSec" INTEGER,
    "supportsAspectRatio" BOOLEAN NOT NULL DEFAULT true,
    "supportsDuration" BOOLEAN NOT NULL DEFAULT true,
    "resolutions" TEXT[] DEFAULT ARRAY['720p']::TEXT[],
    "pricePerSecondUsdConfirmed" DOUBLE PRECISION,
    "pricingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kie_video_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_edit_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "generateFixedDurationSec" INTEGER NOT NULL DEFAULT 8,
    "maxConcurrentJobsPerUser" INTEGER NOT NULL DEFAULT 1,
    "maxJobsPerDayPerUser" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_edit_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_edit_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kieVideoModelId" TEXT NOT NULL,
    "mode" "VideoEditMode" NOT NULL,
    "prompt" TEXT NOT NULL,
    "referenceImageKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "videoKey" TEXT,
    "videoWindowStartSec" DOUBLE PRECISION,
    "videoWindowEndSec" DOUBLE PRECISION,
    "aspectRatio" TEXT DEFAULT '16:9',
    "resolution" TEXT NOT NULL DEFAULT '720p',
    "status" "VideoJobStatus" NOT NULL DEFAULT 'PENDING',
    "kieTaskId" TEXT,
    "resultVideoKey" TEXT,
    "errorMessage" TEXT,
    "creditsConsumedRaw" DOUBLE PRECISION,
    "creditCost" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "video_edit_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kie_video_models_slug_key" ON "kie_video_models"("slug");

-- CreateIndex
CREATE INDEX "video_edit_jobs_userId_idx" ON "video_edit_jobs"("userId");

-- AddForeignKey
ALTER TABLE "video_edit_jobs" ADD CONSTRAINT "video_edit_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_edit_jobs" ADD CONSTRAINT "video_edit_jobs_kieVideoModelId_fkey" FOREIGN KEY ("kieVideoModelId") REFERENCES "kie_video_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed: تنها مدل Kie.ai که schema/قیمتش با تست واقعی تأیید شده (docs/PRD-video-edit-omni-kie.md
-- §۲ و §۶.۲ — تست واقعی ۱۴۰۵/۰۶/۱۵: ۴ث/۷۲۰p/متن‌محض = ۶۳ credit = $۰.۰۷۸۷۵/ثانیه). بقیه‌ی
-- مدل‌های video-to-video/video-editing کی‌ای (Seedance 2.0، Kling Motion Control، Wan 2.7 و...)
-- عمداً این‌جا seed نشده‌اند — هرکدام schema ورودی متفاوتی دارند که هنوز تک‌تک تأیید نشده
-- (بخش ۱۱ سند)؛ افزودنشان یعنی یک INSERT مشابه بعد از تأیید schema/قیمت هرکدام، از پنل ادمین.
INSERT INTO "kie_video_models" (
  "id", "slug", "displayName", "category", "isActive", "sortOrder",
  "supportsImages", "maxImages", "supportsVideo", "maxVideoDurationSec", "maxVideoWindowSec",
  "supportsAspectRatio", "supportsDuration", "resolutions",
  "pricePerSecondUsdConfirmed", "pricingNote", "updatedAt"
) VALUES (
  gen_random_uuid(), 'gemini-omni-video', 'Gemini Omni', 'GENERATE', true, 0,
  true, 7, true, 30, 10,
  true, true, ARRAY['720p','1080p','4k'],
  0.07875, 'تست واقعی ۱۴۰۵/۰۶/۱۵: ۴ث/۷۲۰p/متن‌محض = ۶۳ credit (۱credit=$۰.۰۰۵) — یک نقطه‌داده، نه منحنی کامل قیمت (بخش ۶.۲ سند)', now()
);

