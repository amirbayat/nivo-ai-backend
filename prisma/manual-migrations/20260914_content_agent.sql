-- AlterEnum
ALTER TYPE "CreativePromptSourceType" ADD VALUE 'AGENT_DISCOVERED';

-- AlterTable
ALTER TABLE "creative_prompts" ADD COLUMN     "agentSourceUrl" TEXT;

-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "agentSourceUrls" JSONB,
ADD COLUMN     "isAgentGenerated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "content_agent_api_keys" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_agent_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_agent_api_keys_keyHash_key" ON "content_agent_api_keys"("keyHash");

