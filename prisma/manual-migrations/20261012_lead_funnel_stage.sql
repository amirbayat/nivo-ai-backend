-- CreateEnum
CREATE TYPE "LeadFunnelStage" AS ENUM ('NEW', 'DISCOVERING_NEED', 'PITCHED', 'OBJECTION_RAISED', 'READY_TO_CAPTURE', 'LEAD_CAPTURED', 'NOT_RELEVANT');

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "leadFunnelStage" "LeadFunnelStage";

