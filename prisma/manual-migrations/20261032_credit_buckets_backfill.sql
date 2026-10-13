-- docs/PRD-nivo-sales-unified.md فاز ۱ (تسک 1.1، مشخصات ج ۲۳.۱) — قدم ۳ از ۳: انتقال داده
-- موجودی فعلی هر فروشگاه (≠ ۰) به بخش LEGACY. عمداً به هیچ درگاهی نسبت داده نمی‌شود (منبع
-- واقعی از تاریخچه قابل بازسازی نیست). idempotent: فروشگاهی که بخش LEGACY دارد دست نمی‌خورد.
-- اگر قبل از اجرای این فایل کد جدید دیپلوی شده باشد هم مشکلی نیست (کسر/شارژ ناوردایی را
-- به‌صورت خودکار در LEGACY ترمیم می‌کند)؛ این فایل فقط موجودی را از همان ابتدا هم‌تراز می‌کند.
INSERT INTO "store_credit_buckets" ("id", "storeId", "source", "balanceToman", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || s."id")::uuid::text,
       s."id", 'LEGACY', s."creditBalanceToman", now()
FROM "stores" s
WHERE s."creditBalanceToman" <> 0
ON CONFLICT ("storeId", "source") DO NOTHING;
