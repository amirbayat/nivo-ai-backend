-- ACE-ITEM: ACE-16  (برگشت 20261058_ace16_product_brief.sql)
-- WARNING: داده‌ی جدول product_brief پاک می‌شود. اگر لازم است اول بک‌آپ: \copy product_brief TO 'product_brief.csv' CSV HEADER
-- قبلش: کد این آیتم revert و deploy شده باشد (۱.۶ کامیت‌ها بند ۵)
DROP INDEX IF EXISTS "product_brief_storeId_idx";
DROP TABLE IF EXISTS "product_brief";
