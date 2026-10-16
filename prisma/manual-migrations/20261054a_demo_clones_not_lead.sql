-- DEMO-1 (اختیاری): یکدست‌سازی کپی‌های دموی قدیمی. بدون اجرای این فایل هم کد درست کار می‌کند
-- (isNivoLeadStore کپی‌های isDemo را SHOP حساب می‌کند). جدول Store با @@map("stores") است.
UPDATE "stores" SET "leadCaptureOnly" = false WHERE "isDemo" = true;
