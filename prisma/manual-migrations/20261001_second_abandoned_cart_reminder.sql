-- docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۲ — یادآوری دوم سبد رهاشده (با کد
-- تخفیف خودکار، ۱۸ ساعت بعد از یادآوری اول). کاملاً additive.

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "secondAbandonedCartReminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sales_conversations_currentState_secondAbandonedCartReminde_idx" ON "sales_conversations"("currentState", "secondAbandonedCartReminderSentAt");
