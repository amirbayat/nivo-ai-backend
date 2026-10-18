-- docs/PRD-seller-conversations-inbox.md §۴.۱ — صندوق گفتگوهای فروشنده
-- فقط افزودنی (ADD COLUMN nullable + INDEX)؛ هیچ داده‌ای حذف/بازنویسی نمی‌شود.

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "humanTakenOverAt" TIMESTAMP(3),
ADD COLUMN     "lastCustomerMessageAt" TIMESTAMP(3),
ADD COLUMN     "lastMessageAt" TIMESTAMP(3),
ADD COLUMN     "sellerLastReadAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sales_conversations_storeId_isTest_lastMessageAt_idx" ON "sales_conversations"("storeId", "isTest", "lastMessageAt");

-- Backfill: آخرین پیام از هر طرف
UPDATE "sales_conversations" c
SET "lastMessageAt" = e.last_at
FROM (
  SELECT "conversationId", MAX("createdAt") AS last_at
  FROM "conversation_events"
  WHERE "type" IN ('CUSTOMER_MESSAGE', 'AGENT_REPLY', 'SELLER_MESSAGE')
  GROUP BY "conversationId"
) e
WHERE e."conversationId" = c."id";

-- Backfill: آخرین پیام مشتری
UPDATE "sales_conversations" c
SET "lastCustomerMessageAt" = e.last_at
FROM (
  SELECT "conversationId", MAX("createdAt") AS last_at
  FROM "conversation_events"
  WHERE "type" = 'CUSTOMER_MESSAGE'
  GROUP BY "conversationId"
) e
WHERE e."conversationId" = c."id";

-- Backfill: گفتگوهای قدیمی بعد از دیپلوی ناگهان «خوانده‌نشده» نشوند
UPDATE "sales_conversations" SET "sellerLastReadAt" = now();

-- Backfill: گفتگوهایی که همین حالا دست انسان‌اند
UPDATE "sales_conversations"
SET "humanTakenOverAt" = "updatedAt"
WHERE "isMutedForHuman" = true AND "humanTakenOverAt" IS NULL;
