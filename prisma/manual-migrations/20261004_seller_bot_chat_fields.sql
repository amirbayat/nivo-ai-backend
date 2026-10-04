-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "sellerBotChatId" TEXT,
ADD COLUMN     "sellerBotLinkedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "stores_sellerBotChatId_key" ON "stores"("sellerBotChatId");

