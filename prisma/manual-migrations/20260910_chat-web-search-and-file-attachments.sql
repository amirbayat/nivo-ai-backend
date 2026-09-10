-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "attachments" JSONB,
ADD COLUMN     "citations" JSONB;

-- AlterTable
ALTER TABLE "ai_models" ADD COLUMN     "supportsWebSearch" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "chat_config" ADD COLUMN     "maxExtractedChars" INTEGER NOT NULL DEFAULT 80000,
ADD COLUMN     "maxFileSizeMb" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "webSearchCreditCostToman" INTEGER NOT NULL DEFAULT 0;

