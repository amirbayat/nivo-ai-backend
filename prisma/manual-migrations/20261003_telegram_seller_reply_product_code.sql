-- docs/PRD-telegram-bot-channel.md بخش ۹.۱-۹.۳ — اتصال تلگرام فروشنده (chat_id + توکن
-- یک‌بارمصرف) + کد کوتاه اختیاری محصول (additive, safe)

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "ownerTelegramChatId" TEXT,
ADD COLUMN     "telegramConnectToken" TEXT,
ADD COLUMN     "telegramConnectTokenExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "stores_telegramConnectToken_key" ON "stores"("telegramConnectToken");

-- CreateIndex
CREATE UNIQUE INDEX "products_storeId_code_key" ON "products"("storeId", "code");

