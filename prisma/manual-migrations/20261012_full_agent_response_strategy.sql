-- AlterEnum
ALTER TYPE "ResponseStrategy" ADD VALUE 'FULL_AGENT';

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "openQuestionStreak" INTEGER NOT NULL DEFAULT 0;

