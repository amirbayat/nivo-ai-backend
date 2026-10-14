-- Step 6.5 (F2). Run this file alone, before any code that writes the new value.
-- Postgres cannot use a new enum value in the same transaction that adds it.
-- Idempotent. One statement, auto-commit.

ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'AWAITING_SELLER_CONFIRM';
