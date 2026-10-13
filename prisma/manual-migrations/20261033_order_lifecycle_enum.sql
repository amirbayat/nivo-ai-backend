-- docs/PRD-nivo-sales-unified.md فاز ۳ (تسک 3.1) — قدم ۱ از ۳ (+ یک فایل اختیاری بعد از دیپلوی)
-- مقدارهای جدید OrderStatus (ALTER TYPE ... ADD VALUE باید جدا و قبل از فایل اصلی اجرا شود)
-- و enumهای تازه‌ی چرخه‌ی سفارش. فقط افزودن؛ idempotent. هر statement را جدا (auto-commit) اجرا کن.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

DO $$ BEGIN
  CREATE TYPE "ReceiptType" AS ENUM ('IMAGE', 'MANUAL_INFO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderActor" AS ENUM ('BUYER', 'SELLER', 'SYSTEM', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderChannel" AS ENUM ('WEB', 'TELEGRAM', 'COPILOT', 'CRON');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefundStatus" AS ENUM ('AWAITING_DESTINATION', 'READY', 'DONE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefundReason" AS ENUM ('ORDER_REJECTED', 'ORDER_CANCELLED', 'ITEM_UNAVAILABLE', 'OVERPAID', 'RETURNED', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "RefundDestinationType" AS ENUM ('CARD', 'SHEBA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderIssueReason" AS ENUM ('NOT_RECEIVED', 'DAMAGED', 'WRONG_ITEM', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "OrderIssueStatus" AS ENUM ('OPEN', 'RESOLVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnType" AS ENUM ('RETURN', 'EXCHANGE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnReason" AS ENUM ('SIZE', 'DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'BUYER_SHIPPED', 'RECEIVED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnPolicyMode" AS ENUM ('NONE', 'EXCHANGE_ONLY', 'EXCHANGE_AND_RETURN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnShippingPaidBy" AS ENUM ('BUYER', 'SELLER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
