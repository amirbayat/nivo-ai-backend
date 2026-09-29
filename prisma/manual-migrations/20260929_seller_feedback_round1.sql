-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "telegramUrl" TEXT,
ADD COLUMN     "websiteUrl" TEXT;

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "abVariant" TEXT;

-- CreateTable
CREATE TABLE "ab_model_metrics" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ab_model_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ab_model_metrics_variant_idx" ON "ab_model_metrics"("variant");

-- CreateIndex
CREATE INDEX "ab_model_metrics_conversationId_idx" ON "ab_model_metrics"("conversationId");

