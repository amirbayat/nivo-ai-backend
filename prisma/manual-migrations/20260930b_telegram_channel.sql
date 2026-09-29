-- docs/PRD-telegram-bot-channel.md بخش ۲ — تعمیم Customer به چند-کاناله (WEB/TELEGRAM).
-- توجه: این فایل باید بعد از 20260930_seller_knowledge_base.sql اجرا شود (مستقل از آن، ولی
-- ترتیب زمانی درست است). به‌صورت دستی از diff کامل استخراج شده تا فقط دلتای واقعی این فاز
-- باشد (بدون تکرار CREATE TABLE store_kb_entries که در فایل قبلی است).

-- CreateEnum
CREATE TYPE "CustomerChannel" AS ENUM ('WEB', 'TELEGRAM');

-- DropIndex — یکتایی سراسری قدیمی روی sessionToken جایش را به یکتایی ترکیبی per-store می‌دهد
DROP INDEX "customers_sessionToken_key";

-- AlterTable
ALTER TABLE "customers"
  ADD COLUMN "channel" "CustomerChannel" NOT NULL DEFAULT 'WEB',
  ADD COLUMN "telegramChatId" TEXT,
  ALTER COLUMN "sessionToken" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "customers_storeId_sessionToken_key" ON "customers"("storeId", "sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "customers_storeId_telegramChatId_key" ON "customers"("storeId", "telegramChatId");
