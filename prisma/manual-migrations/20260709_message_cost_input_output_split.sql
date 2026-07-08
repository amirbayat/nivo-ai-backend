-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "costInputUsdMicros" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "costOutputUsdMicros" INTEGER NOT NULL DEFAULT 0;
