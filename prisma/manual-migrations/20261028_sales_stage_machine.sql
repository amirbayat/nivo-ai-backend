-- CreateEnum
CREATE TYPE "SalesStage" AS ENUM ('OPENING', 'DISCOVERY', 'RECOMMENDATION', 'EVALUATION', 'OBJECTION', 'CLOSING', 'CHECKOUT', 'POST_PURCHASE', 'NOT_A_FIT', 'DORMANT');

-- AlterTable
ALTER TABLE "sales_agent_global_config" ADD COLUMN     "salesStageMachineEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "salesStage" "SalesStage";

-- CreateIndex
CREATE INDEX "sales_conversations_storeId_salesStage_idx" ON "sales_conversations"("storeId", "salesStage");

