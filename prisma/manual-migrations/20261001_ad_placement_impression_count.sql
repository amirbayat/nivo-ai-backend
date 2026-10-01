-- docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۳ — فقط «نشان داده شد یا نه»، طبق
-- تصمیم خودِ PRD-seller-advertising-placements.md که نرخ کلیک را عمداً خارج از فاز گذاشت.
-- کاملاً additive، یک ستون جدید با DEFAULT 0، صفر تغییر رفتار برای ردیف‌های موجود.

-- AlterTable
ALTER TABLE "ad_placements" ADD COLUMN     "impressionCount" INTEGER NOT NULL DEFAULT 0;
