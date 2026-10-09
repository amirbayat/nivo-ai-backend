-- AlterTable
ALTER TABLE "sales_agent_global_config" ADD COLUMN     "buyerCostMarkup" DOUBLE PRECISION NOT NULL DEFAULT 2,
ADD COLUMN     "sellerCostMarkup" DOUBLE PRECISION NOT NULL DEFAULT 1.5;

-- AlterTable
ALTER TABLE "credit_usage_events" ADD COLUMN     "chargedToman" INTEGER NOT NULL DEFAULT 0;

