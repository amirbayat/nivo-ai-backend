-- CreateEnum
CREATE TYPE "StudioProjectStatus" AS ENUM ('DRAFT', 'CHARACTER_SELECTED', 'STORYBOARD_READY', 'COMPLETED');

-- CreateEnum
CREATE TYPE "StudioShotVideoStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "StudioModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AiModelType" ADD VALUE 'VIDEO_GEN';

-- AlterTable
ALTER TABLE "ai_models" ADD COLUMN     "videoGenAudioMultiplier" DOUBLE PRECISION,
ADD COLUMN     "videoGenPricePerSecondUsd" DOUBLE PRECISION,
ADD COLUMN     "videoGenSupportedDurationsSec" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "videoGenSupportedSizes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "video_studio_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "characterOptionCount" INTEGER NOT NULL DEFAULT 4,
    "maxCharacterRegeneratesPerProject" INTEGER NOT NULL DEFAULT 10,
    "maxConcurrentVideoJobsPerUser" INTEGER NOT NULL DEFAULT 2,
    "maxVideoGenPerDayPerUser" INTEGER,
    "defaultAudioEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_studio_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "initialPrompt" TEXT NOT NULL,
    "visualStyle" TEXT,
    "status" "StudioProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "chatModelId" TEXT,
    "photoModelId" TEXT,
    "videoModelId" TEXT,
    "imageAspectRatio" TEXT,
    "videoAspectRatio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_character_options" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "imageKey" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "moderationStatus" "StudioModerationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_character_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_shots" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "previewImageKey" TEXT,
    "audioEnabled" BOOLEAN NOT NULL DEFAULT false,
    "moderationStatus" "StudioModerationStatus" NOT NULL DEFAULT 'PENDING',
    "videoStatus" "StudioShotVideoStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "videoJobId" TEXT,
    "videoKey" TEXT,
    "creditCost" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_shots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "studio_character_options_projectId_idx" ON "studio_character_options"("projectId");

-- CreateIndex
CREATE INDEX "studio_shots_projectId_idx" ON "studio_shots"("projectId");

-- AddForeignKey
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_character_options" ADD CONSTRAINT "studio_character_options_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_shots" ADD CONSTRAINT "studio_shots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

