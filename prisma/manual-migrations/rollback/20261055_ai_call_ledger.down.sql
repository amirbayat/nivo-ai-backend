-- ACE-ITEM: ACE-0  (برگشت 20261055_ai_call_ledger.sql)
-- WARNING: تمام داده‌ی ai_call_ledger پاک می‌شود. اگر لازم است اول بک‌آپ: \copy ai_call_ledger TO 'ai_call_ledger.csv' CSV HEADER
-- قبلش: کد ACE-0 revert و deploy شده باشد (یا بپذیر که ledger فقط warning یک‌باره می‌دهد؛ کد بدون جدول هم نمی‌شکند)
DROP TABLE IF EXISTS "ai_call_ledger";
