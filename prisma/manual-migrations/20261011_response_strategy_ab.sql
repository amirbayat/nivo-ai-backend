-- CreateEnum
CREATE TYPE "ResponseStrategy" AS ENUM ('RULE_BASED', 'SIMPLE_AGENT');

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "responseStrategy" "ResponseStrategy" NOT NULL DEFAULT 'RULE_BASED';

