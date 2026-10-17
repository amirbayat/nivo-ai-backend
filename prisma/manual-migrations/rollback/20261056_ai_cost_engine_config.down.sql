-- ACE-ITEM: ACE-0/ACE-3  (برگشت 20261056_ai_cost_engine_config.sql)
-- WARNING: کلید لایه‌ها، engineMode، storeOverrides و تاریخچه‌ی audit پاک می‌شود. بعد از حذف، همه‌چیز پایدار + پیش‌فرض کد است.
-- بک‌آپ: \copy ai_cost_engine_config TO 'ai_cost_engine_config.csv' CSV HEADER
-- قبلش: کد این آیتم revert و deploy شده باشد
DROP TABLE IF EXISTS "ai_cost_engine_config";
