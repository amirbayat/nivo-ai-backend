-- docs/EXECUTION-PLAN.md قدم ۴ — رصد هزینه‌ی واقعی per-request از OpenRouter (usage.cost)
-- در کنار تخمین داخلی فعلی، نه جایگزین آن. تایید‌شده با تست مستقیم روی API واقعی OpenRouter
-- (۱۴۰۵-۰۶-۱۲ / 2026-09-02): usage.cost دلار است، اینجا × ۱e6 ذخیره می‌شود تا با بقیه‌ی
-- ستون‌های *UsdMicros یکدست بماند. openrouterRealCostToman هم با نرخ همون لحظه (مثل
-- costToman) ذخیره می‌شود، نه بازمحاسبه‌ی بعدی در آنالیز با نرخ روز.

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "openrouterRealCostUsdMicros" INTEGER,
ADD COLUMN     "openrouterRealCostToman" INTEGER;
