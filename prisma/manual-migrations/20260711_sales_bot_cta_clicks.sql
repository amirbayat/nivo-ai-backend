-- شمارش کلیک روی CTAهای ویجت فروش («شروع رایگان» / «مشاهده پلن‌ها») برای آنالیتیکس.
-- فقط ADD COLUMN — ایمن برای اجرا روی پروداکشن.

ALTER TABLE "sales_bot_daily_usage" ADD COLUMN "ctaFreeStartClicks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "ctaPricingClicks" INTEGER NOT NULL DEFAULT 0;
