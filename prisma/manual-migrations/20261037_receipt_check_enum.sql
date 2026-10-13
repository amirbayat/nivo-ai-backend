-- Step 5 (3.9). Run this file alone, before 20261038_short_link.sql.
-- Postgres cannot use a new enum value in the same transaction that adds it.
-- Idempotent. One statement, auto-commit.

ALTER TYPE "CreditUsageKind" ADD VALUE IF NOT EXISTS 'RECEIPT_CHECK';
