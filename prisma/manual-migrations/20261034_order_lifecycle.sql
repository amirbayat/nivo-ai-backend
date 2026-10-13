-- docs/PRD-nivo-sales-unified.md فاز ۳ (تسک 3.1) — قدم ۲ از ۳
-- ستون‌ها و جدول‌های چرخه‌ی سفارش (کد سفارش، رهگیری، OrderStatusEvent، NotificationLog،
-- ProductEvent، OrderRefund/OrderIssue/OrderReturn، تنظیمات مرجوعی فروشگاه، کلید rollout پیامک).
-- فقط افزودن (بدون DROP)؛ idempotent. باید بعد از 20261033_order_lifecycle_enum.sql اجرا شود.
-- orderCode عمداً nullable است (unique روی NULLها مشکلی ندارد)؛ NOT NULL شدنش فایل اختیاری
-- 20261036_order_code_not_null.sql است که فقط بعد از دیپلوی کد جدید اجرا می‌شود.

ALTER TABLE "sales_agent_global_config" ADD COLUMN IF NOT EXISTS "orderSmsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "stores" ADD COLUMN IF NOT EXISTS "returnPolicyMode" "ReturnPolicyMode" NOT NULL DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS "returnShippingPaidBy" "ReturnShippingPaidBy" NOT NULL DEFAULT 'BUYER',
ADD COLUMN IF NOT EXISTS "returnWindowDays" INTEGER NOT NULL DEFAULT 7;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "carrier" TEXT,
ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "orderCode" TEXT,
ADD COLUMN IF NOT EXISTS "paymentDueAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "paymentReminderSentAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "receiptCheck" JSONB,
ADD COLUMN IF NOT EXISTS "receiptHash" TEXT,
ADD COLUMN IF NOT EXISTS "receiptManualInfo" JSONB,
ADD COLUMN IF NOT EXISTS "receiptType" "ReceiptType",
ADD COLUMN IF NOT EXISTS "returnPolicySnapshot" JSONB,
ADD COLUMN IF NOT EXISTS "sellerNote" TEXT,
ADD COLUMN IF NOT EXISTS "trackingCode" TEXT;

CREATE TABLE IF NOT EXISTS "order_status_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "from" "OrderStatus",
    "to" "OrderStatus" NOT NULL,
    "actor" "OrderActor" NOT NULL,
    "actorId" TEXT,
    "channel" "OrderChannel",
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_refunds" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "amountToman" INTEGER NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "note" TEXT,
    "status" "RefundStatus" NOT NULL,
    "destinationType" "RefundDestinationType",
    "destinationEnc" TEXT,
    "destinationMasked" TEXT,
    "holderName" TEXT,
    "bankName" TEXT,
    "destinationAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidRef" TEXT,
    "proofImageKey" TEXT,
    "createdByActor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_refunds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_issues" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reason" "OrderIssueReason" NOT NULL,
    "text" TEXT,
    "images" TEXT[],
    "status" "OrderIssueStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "order_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "order_returns" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "ReturnType" NOT NULL,
    "items" JSONB NOT NULL,
    "reason" "ReturnReason" NOT NULL,
    "text" TEXT,
    "images" TEXT[],
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "rejectReason" TEXT,
    "buyerTrackingCode" TEXT,
    "priceDiffToman" INTEGER NOT NULL DEFAULT 0,
    "refundId" TEXT,
    "exchangeOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storeId" TEXT,
    "conversationId" TEXT,
    "userId" TEXT,
    "props" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_logs" (
    "id" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "costToman" INTEGER NOT NULL DEFAULT 0,
    "entityId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "order_status_events_orderId_createdAt_idx" ON "order_status_events"("orderId", "createdAt");

CREATE INDEX IF NOT EXISTS "order_refunds_storeId_status_createdAt_idx" ON "order_refunds"("storeId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "order_refunds_orderId_idx" ON "order_refunds"("orderId");

CREATE INDEX IF NOT EXISTS "order_issues_orderId_idx" ON "order_issues"("orderId");

CREATE INDEX IF NOT EXISTS "order_returns_orderId_idx" ON "order_returns"("orderId");

CREATE INDEX IF NOT EXISTS "order_returns_storeId_status_idx" ON "order_returns"("storeId", "status");

CREATE INDEX IF NOT EXISTS "product_events_name_createdAt_idx" ON "product_events"("name", "createdAt");

CREATE INDEX IF NOT EXISTS "product_events_storeId_createdAt_idx" ON "product_events"("storeId", "createdAt");

CREATE INDEX IF NOT EXISTS "notification_logs_template_entityId_createdAt_idx" ON "notification_logs"("template", "entityId", "createdAt");

CREATE INDEX IF NOT EXISTS "notification_logs_to_channel_createdAt_idx" ON "notification_logs"("to", "channel", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "orders_orderCode_key" ON "orders"("orderCode");

CREATE INDEX IF NOT EXISTS "orders_storeId_receiptHash_idx" ON "orders"("storeId", "receiptHash");

CREATE INDEX IF NOT EXISTS "orders_status_paymentDueAt_idx" ON "orders"("status", "paymentDueAt");

DO $$ BEGIN
  ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_refunds" ADD CONSTRAINT "order_refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_issues" ADD CONSTRAINT "order_issues_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
