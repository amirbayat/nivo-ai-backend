-- CreateEnum
CREATE TYPE "LeadFollowUpStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'DECLINED');

-- AlterTable
ALTER TABLE "lead_profiles" ADD COLUMN     "discountOffered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "followUpStatus" "LeadFollowUpStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "guideContentMd" TEXT,
ADD COLUMN     "guideSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sales_bot_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "contextMd" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'openai/gpt-5.4-mini',
    "maxMessages" INTEGER NOT NULL DEFAULT 15,
    "discountEnabled" BOOLEAN NOT NULL DEFAULT true,
    "discountMinMessages" INTEGER NOT NULL DEFAULT 6,
    "discountPromptText" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_bot_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_bot_daily_usage" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "tokensInput" INTEGER NOT NULL DEFAULT 0,
    "tokensOutput" INTEGER NOT NULL DEFAULT 0,
    "costToman" INTEGER NOT NULL DEFAULT 0,
    "costUsdMicros" INTEGER NOT NULL DEFAULT 0,
    "sessionsStarted" INTEGER NOT NULL DEFAULT 0,
    "discountOffersShown" INTEGER NOT NULL DEFAULT 0,
    "phonesCaptured" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_bot_daily_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_bot_daily_usage_date_idx" ON "sales_bot_daily_usage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "sales_bot_daily_usage_date_key" ON "sales_bot_daily_usage"("date");
