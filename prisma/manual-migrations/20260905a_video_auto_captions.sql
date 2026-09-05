-- CreateEnum
CREATE TYPE "CaptionProjectStatus" AS ENUM ('UPLOADED', 'TRANSCRIBING', 'READY_FOR_EDIT', 'RENDERING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "AiModelType" ADD VALUE 'AUDIO_TRANSCRIPTION';

-- AlterTable
ALTER TABLE "credit_config" ADD COLUMN     "captionReRenderCreditCost" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "ai_models" ADD COLUMN     "asrPricePerMinuteUsd" DOUBLE PRECISION,
ADD COLUMN     "asrSupportsWordTimestamps" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "caption_pricing_tiers" (
    "id" TEXT NOT NULL,
    "maxDurationSec" INTEGER,
    "creditCost" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caption_pricing_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caption_projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceVideoKey" TEXT NOT NULL,
    "sourceDurationSec" DOUBLE PRECISION,
    "asrModelName" TEXT,
    "transcriptWords" JSONB,
    "segments" JSONB,
    "styleId" TEXT,
    "styleOverrides" JSONB,
    "status" "CaptionProjectStatus" NOT NULL DEFAULT 'UPLOADED',
    "renderedVideoKey" TEXT,
    "asrCostUsd" DOUBLE PRECISION,
    "renderCreditCost" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "caption_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "caption_projects_userId_idx" ON "caption_projects"("userId");

-- AddForeignKey
ALTER TABLE "caption_projects" ADD CONSTRAINT "caption_projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

