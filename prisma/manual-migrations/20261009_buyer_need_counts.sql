-- docs/PRD-buyer-preference-personalization.md بخش ۹.۳ — فاز ۱ شناخت سلیقه‌ی خریدار:
-- فقط یک ستون نال‌پذیر جدید برای تجمیع شمارنده‌ی BuyerNeedTag به‌ازای هر خریدار.
-- کاملاً additive، بدون drop/تغییر نوع هیچ ستونی. صفر تغییر رفتار ایجنت در این فاز.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "buyerNeedCounts" JSONB;
