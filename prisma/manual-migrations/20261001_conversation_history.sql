-- DropIndex
DROP INDEX "sales_conversations_customerId_key";

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sales_conversations_customerId_createdAt_idx" ON "sales_conversations"("customerId", "createdAt");

