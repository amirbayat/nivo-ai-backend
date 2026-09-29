-- AlterEnum
ALTER TYPE "ConversationEventType" ADD VALUE 'SELLER_MESSAGE';

-- CreateIndex
CREATE INDEX "sales_conversations_storeId_isMutedForHuman_idx" ON "sales_conversations"("storeId", "isMutedForHuman");

