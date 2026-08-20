-- CreateEnum
CREATE TYPE "CreativePromptSourceType" AS ENUM ('CURATED', 'USER_EXTRACTED');

-- CreateEnum
CREATE TYPE "CreativePromptReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "credit_config" ADD COLUMN     "defaultExtractedPromptCreditCost" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "promptExtractionCreditCost" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "creative_prompts" ADD COLUMN     "reviewStatus" "CreativePromptReviewStatus",
ADD COLUMN     "sourceImageKey" TEXT,
ADD COLUMN     "sourceType" "CreativePromptSourceType" NOT NULL DEFAULT 'CURATED',
ADD COLUMN     "submittedByUserId" TEXT;

-- AlterTable
ALTER TABLE "creative_generations" ADD COLUMN     "userInput" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "pinnedPromptId" TEXT;

-- CreateIndex
CREATE INDEX "creative_prompts_sourceType_reviewStatus_idx" ON "creative_prompts"("sourceType", "reviewStatus");

-- AddForeignKey
ALTER TABLE "creative_prompts" ADD CONSTRAINT "creative_prompts_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_pinnedPromptId_fkey" FOREIGN KEY ("pinnedPromptId") REFERENCES "creative_prompts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

