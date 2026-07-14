-- بخش ۱۸.۲۰ — شمارنده‌ی نمایشی ظرفیت ثبت‌نام از حالت قطعی/سرور-محور به یک‌بار-محاسبه/رندر-فرانت تغییر کرد.
-- فیلدهای تکی initial/floor به بازه‌ی Min/Max تبدیل شدند تا هر بار مقدار متفاوتی (در بازه) انتخاب شود؛
-- displayTickSeconds (ثانیه) با displayAnimationTickMs (میلی‌ثانیه) جایگزین شد چون انیمیشن حالا سمت
-- فرانت و با تیک‌های نرم‌تر (پیش‌فرض ۵۰۰ms) اجرا می‌شود، نه با پنجره‌های چند-ثانیه‌ای سمت سرور.
-- ستون‌های قدیمی حذف می‌شوند — فقط تنظیمات نمایشی کمپین‌اند، نه داده‌ی کسب‌وکاری (grantedCount/waitlist دست‌نخورده می‌ماند).

ALTER TABLE "launch_campaigns" DROP COLUMN "displayFloor",
DROP COLUMN "displayInitialPct",
DROP COLUMN "displayTickSeconds",
ADD COLUMN     "displayAnimationTickMs" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "displayFloorMax" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "displayFloorMin" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "displayInitialPctMax" INTEGER NOT NULL DEFAULT 25,
ADD COLUMN     "displayInitialPctMin" INTEGER NOT NULL DEFAULT 15,
ALTER COLUMN "displayDecrementMax" SET DEFAULT 3;
