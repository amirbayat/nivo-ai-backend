-- F19. One-time refund-card reminder and one-time delivery check.
-- Safe to run before the code that writes these columns.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "deliveryCheckSentAt" TIMESTAMP(3);
ALTER TABLE "order_refunds" ADD COLUMN IF NOT EXISTS "destinationRemindedAt" TIMESTAMP(3);
