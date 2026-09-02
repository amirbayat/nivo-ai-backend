-- AlterTable
ALTER TABLE "ai_models" ADD COLUMN     "badges" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "description" TEXT;
