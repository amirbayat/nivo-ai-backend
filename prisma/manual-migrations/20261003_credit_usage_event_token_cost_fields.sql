-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "freeVoiceQuotaResetAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "credit_usage_events" ADD COLUMN     "costUsdMicros" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokensInput" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokensOutput" INTEGER NOT NULL DEFAULT 0;

