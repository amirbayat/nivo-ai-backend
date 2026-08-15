-- CreateEnum
CREATE TYPE "CreativeOutputType" AS ENUM ('IMAGE', 'TEXT');

-- CreateEnum
CREATE TYPE "CreativeSegment" AS ENUM ('GENERAL', 'INSTAGRAM', 'YOUTUBE', 'BUSINESS');

-- CreateEnum
CREATE TYPE "CreativeGenerationStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "credit_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "tomanPerCredit" INTEGER NOT NULL DEFAULT 1200,
    "purchaseMarkup" DOUBLE PRECISION NOT NULL DEFAULT 1.3,
    "freeSignupCredits" INTEGER NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_packages" (
    "id" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isBestValue" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_prompts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outputType" "CreativeOutputType" NOT NULL,
    "segment" "CreativeSegment" NOT NULL,
    "description" TEXT,
    "contextMd" TEXT NOT NULL,
    "userPromptTemplate" TEXT NOT NULL,
    "exampleImageUrl" TEXT,
    "aspectRatio" TEXT,
    "requiresUserImage" BOOLEAN NOT NULL DEFAULT false,
    "creditCost" INTEGER NOT NULL,
    "preferredModel" TEXT,
    "isTrending" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "CreativeSegment" NOT NULL,
    "niche" TEXT,
    "contextMd" TEXT NOT NULL,
    "brandColor" TEXT,
    "logoImageKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_generations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "projectId" TEXT,
    "outputType" "CreativeOutputType" NOT NULL,
    "inputImageKeys" JSONB,
    "outputImageKey" TEXT,
    "outputText" TEXT,
    "creditCost" INTEGER NOT NULL,
    "costToman" INTEGER NOT NULL,
    "model" TEXT,
    "status" "CreativeGenerationStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creative_prompt_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "platform" "CreativeSegment",
    "referenceUrl" TEXT,
    "isReviewed" BOOLEAN NOT NULL DEFAULT false,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_prompt_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creative_prompts_outputType_segment_isActive_idx" ON "creative_prompts"("outputType", "segment", "isActive");

-- CreateIndex
CREATE INDEX "projects_userId_idx" ON "projects"("userId");

-- CreateIndex
CREATE INDEX "creative_generations_userId_createdAt_idx" ON "creative_generations"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "creative_generations_projectId_createdAt_idx" ON "creative_generations"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "creative_prompt_requests_isReviewed_createdAt_idx" ON "creative_prompt_requests"("isReviewed", "createdAt");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "creative_prompts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_prompt_requests" ADD CONSTRAINT "creative_prompt_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creative_prompt_requests" ADD CONSTRAINT "creative_prompt_requests_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "creative_prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
