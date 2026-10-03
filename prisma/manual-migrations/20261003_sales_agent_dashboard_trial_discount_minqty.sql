-- docs/PRD-sales-agent-checkout-pricing-and-roadmap.md فاز ۳ (بخش ۱.۱، ۵، ۶)
-- فقط ADD COLUMN/CREATE TABLE/CREATE INDEX — بدون ریسک data loss

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "trialCreditRemainingToman" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "trialStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "store_discount_codes" ADD COLUMN     "minQuantity" INTEGER;

-- CreateTable
CREATE TABLE "sales_agent_global_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "freeDailyQuota" INTEGER NOT NULL DEFAULT 10,
    "trialDurationDays" INTEGER NOT NULL DEFAULT 14,
    "trialCreditToman" INTEGER NOT NULL DEFAULT 300000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_agent_global_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_storeId_createdAt_idx" ON "orders"("storeId", "createdAt");
