-- docs/PRD-seller-knowledge-base.md بخش ۹.۲ (سوم) — Product تا امروز هیچ فیلد ساختاریافته‌ای
-- برای مشخصات فنی نداشت؛ suggestedSpecs فقط به انتهای متن description چسبانده می‌شد
-- (composeFinalDescription). این migration صرفاً یک ستون nullable جدید اضافه می‌کند —
-- additive و بدون ریسک از دست رفتن داده.

ALTER TABLE "products" ADD COLUMN "specs" JSONB;
