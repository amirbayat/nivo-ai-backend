-- docs/PRD-product-strategy-and-roadmap.md بخش ۵.۳ (فالوآپ رضایت بعد از خرید) + بخش ۵.۴
-- (سبد رهاشده) — بخش ۱۴ نقشه‌ی راه؛ کاملاً additive — فقط دو ستون نال‌پذیر جدید + دو ایندکس،
-- بدون drop/تغییر نوع هیچ ستونی. بخش ۵.۵ (ابزار QA) هیچ تغییر schema‌ای ندارد.

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "abandonedCartReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "satisfactionFollowUpSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sales_conversations_currentState_abandonedCartReminderSentA_idx" ON "sales_conversations"("currentState", "abandonedCartReminderSentAt");

-- CreateIndex
CREATE INDEX "orders_status_satisfactionFollowUpSentAt_idx" ON "orders"("status", "satisfactionFollowUpSentAt");
