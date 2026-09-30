-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('FREE', 'PAID', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CreditUsageKind" AS ENUM ('TEXT_REPLY', 'VOICE_TTS', 'ASR', 'TOPUP');

-- AlterEnum
ALTER TYPE "PaymentKind" ADD VALUE 'STORE_CREDIT_TOPUP';

-- AlterEnum
ALTER TYPE "CreditPackageScope" ADD VALUE 'STORE_AI_CREDIT';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "creditBalanceToman" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "billingMode" "BillingMode" NOT NULL DEFAULT 'FREE';

-- CreateTable
CREATE TABLE "credit_usage_events" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "model" TEXT NOT NULL,
    "kind" "CreditUsageKind" NOT NULL,
    "costToman" INTEGER NOT NULL,
    "isFreeQuota" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_usage_events_storeId_createdAt_idx" ON "credit_usage_events"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "credit_usage_events_customerId_idx" ON "credit_usage_events"("customerId");

-- CreateIndex
CREATE INDEX "payments_storeId_idx" ON "payments"("storeId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_usage_events" ADD CONSTRAINT "credit_usage_events_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_usage_events" ADD CONSTRAINT "credit_usage_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "sales_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

