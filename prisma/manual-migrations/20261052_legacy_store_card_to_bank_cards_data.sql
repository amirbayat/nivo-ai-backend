-- SP-2 / S7: copy the legacy single card (stores.bankCardNumber/bankOwnerName, written by the old
-- signup wizard) into store_bank_cards, so the card shows on the payments page. DATA migration,
-- idempotent: only stores that have the legacy pair and NO store_bank_cards row get one active row.
-- Running it twice inserts 0 rows the second time. The legacy columns are left untouched.
-- gen_random_uuid() is built in since PostgreSQL 13 (older: CREATE EXTENSION IF NOT EXISTS pgcrypto).
INSERT INTO "store_bank_cards" ("id", "storeId", "cardNumber", "ownerName", "isActive", "sortOrder", "totalConfirmedToman", "createdAt")
SELECT gen_random_uuid()::text, s."id", s."bankCardNumber", s."bankOwnerName", true, 0, 0, NOW()
FROM "stores" s
WHERE s."bankCardNumber" IS NOT NULL
  AND s."bankOwnerName" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "store_bank_cards" c WHERE c."storeId" = s."id");

-- Verify (expect 0 after the run: no store with a legacy card is left without a card row):
-- SELECT count(*) FROM "stores" s
-- WHERE s."bankCardNumber" IS NOT NULL AND s."bankOwnerName" IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM "store_bank_cards" c WHERE c."storeId" = s."id");
