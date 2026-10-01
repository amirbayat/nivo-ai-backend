-- فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — دو تغییر مستقل، هر دو additive (بدون data loss):
-- ۱) credit_packages.storeId — بسته‌ی اعتبار AI مخصوص یک فروشگاه خاص (در کنار بسته‌های عمومی)
-- ۲) stores.freeVoiceConversationsUsed — سقف ۳ مکالمه‌ی وویس‌دار برای فروشنده‌ی بدون اعتبار
-- (conversation-engine.service.ts's reserveFreeVoiceConversationSlot)

-- AlterTable
ALTER TABLE "credit_packages" ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "freeVoiceConversationsUsed" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "credit_packages_storeId_idx" ON "credit_packages"("storeId");

-- AddForeignKey
ALTER TABLE "credit_packages" ADD CONSTRAINT "credit_packages_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

