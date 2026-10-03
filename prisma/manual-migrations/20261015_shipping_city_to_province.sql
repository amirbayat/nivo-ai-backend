-- docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — بازطراحی ارسال از
-- «شهر» (۳۱ مرکز استان) به «استان» (همان ۳۱ استان). برخلاف دیف خام prisma migrate diff (که
-- city را drop و province/provinces را خالی/NOT NULL می‌سازد و داده را از بین می‌برد)، این
-- نسخه‌ی دستی هر مقدار موجود را قبل از drop شدن ستون قدیمی، از مرکز استان به خودِ استان نگاشت
-- می‌کند (مثلاً «شیراز» → «فارس»، «مشهد» → «خراسان رضوی»). اگر مقداری از قبل خارج از فهرست
-- ۳۱تایی بوده (داده‌ی دستی/قدیمی)، همان‌طور که هست باقی می‌ماند (شاخه‌ی ELSE).

-- customer_addresses.city (NOT NULL) -> customer_addresses.province (NOT NULL)
ALTER TABLE "customer_addresses" ADD COLUMN "province" TEXT;

UPDATE "customer_addresses" SET "province" = CASE "city"
  WHEN 'تهران' THEN 'تهران'
  WHEN 'مشهد' THEN 'خراسان رضوی'
  WHEN 'اصفهان' THEN 'اصفهان'
  WHEN 'شیراز' THEN 'فارس'
  WHEN 'تبریز' THEN 'آذربایجان شرقی'
  WHEN 'کرج' THEN 'البرز'
  WHEN 'اهواز' THEN 'خوزستان'
  WHEN 'قم' THEN 'قم'
  WHEN 'کرمانشاه' THEN 'کرمانشاه'
  WHEN 'ارومیه' THEN 'آذربایجان غربی'
  WHEN 'رشت' THEN 'گیلان'
  WHEN 'زاهدان' THEN 'سیستان و بلوچستان'
  WHEN 'کرمان' THEN 'کرمان'
  WHEN 'همدان' THEN 'همدان'
  WHEN 'یزد' THEN 'یزد'
  WHEN 'اردبیل' THEN 'اردبیل'
  WHEN 'بندرعباس' THEN 'هرمزگان'
  WHEN 'اراک' THEN 'مرکزی'
  WHEN 'زنجان' THEN 'زنجان'
  WHEN 'قزوین' THEN 'قزوین'
  WHEN 'ساری' THEN 'مازندران'
  WHEN 'گرگان' THEN 'گلستان'
  WHEN 'خرم‌آباد' THEN 'لرستان'
  WHEN 'سنندج' THEN 'کردستان'
  WHEN 'یاسوج' THEN 'کهگیلویه و بویراحمد'
  WHEN 'بجنورد' THEN 'خراسان شمالی'
  WHEN 'بیرجند' THEN 'خراسان جنوبی'
  WHEN 'بوشهر' THEN 'بوشهر'
  WHEN 'ایلام' THEN 'ایلام'
  WHEN 'شهرکرد' THEN 'چهارمحال و بختیاری'
  WHEN 'سمنان' THEN 'سمنان'
  ELSE "city"
END;

ALTER TABLE "customer_addresses" ALTER COLUMN "province" SET NOT NULL;
ALTER TABLE "customer_addresses" DROP COLUMN "city";

-- store_shipping_rules.city (nullable, NULL = ردیف پیش‌فرض) -> store_shipping_rules.provinces
-- (TEXT[] NOT NULL DEFAULT '{}', خالی = «کل ایران»)
DROP INDEX "store_shipping_rules_storeId_city_key";

ALTER TABLE "store_shipping_rules" ADD COLUMN "provinces" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "store_shipping_rules" SET "provinces" = CASE
  WHEN "city" IS NULL THEN ARRAY[]::TEXT[]
  ELSE ARRAY[(CASE "city"
    WHEN 'تهران' THEN 'تهران'
    WHEN 'مشهد' THEN 'خراسان رضوی'
    WHEN 'اصفهان' THEN 'اصفهان'
    WHEN 'شیراز' THEN 'فارس'
    WHEN 'تبریز' THEN 'آذربایجان شرقی'
    WHEN 'کرج' THEN 'البرز'
    WHEN 'اهواز' THEN 'خوزستان'
    WHEN 'قم' THEN 'قم'
    WHEN 'کرمانشاه' THEN 'کرمانشاه'
    WHEN 'ارومیه' THEN 'آذربایجان غربی'
    WHEN 'رشت' THEN 'گیلان'
    WHEN 'زاهدان' THEN 'سیستان و بلوچستان'
    WHEN 'کرمان' THEN 'کرمان'
    WHEN 'همدان' THEN 'همدان'
    WHEN 'یزد' THEN 'یزد'
    WHEN 'اردبیل' THEN 'اردبیل'
    WHEN 'بندرعباس' THEN 'هرمزگان'
    WHEN 'اراک' THEN 'مرکزی'
    WHEN 'زنجان' THEN 'زنجان'
    WHEN 'قزوین' THEN 'قزوین'
    WHEN 'ساری' THEN 'مازندران'
    WHEN 'گرگان' THEN 'گلستان'
    WHEN 'خرم‌آباد' THEN 'لرستان'
    WHEN 'سنندج' THEN 'کردستان'
    WHEN 'یاسوج' THEN 'کهگیلویه و بویراحمد'
    WHEN 'بجنورد' THEN 'خراسان شمالی'
    WHEN 'بیرجند' THEN 'خراسان جنوبی'
    WHEN 'بوشهر' THEN 'بوشهر'
    WHEN 'ایلام' THEN 'ایلام'
    WHEN 'شهرکرد' THEN 'چهارمحال و بختیاری'
    WHEN 'سمنان' THEN 'سمنان'
    ELSE "city"
  END)]
END;

ALTER TABLE "store_shipping_rules" DROP COLUMN "city";

-- orders.shippingCity (nullable — NULL وقتی requiresShipping=false بوده) -> orders.shippingProvince
ALTER TABLE "orders" ADD COLUMN "shippingProvince" TEXT;

UPDATE "orders" SET "shippingProvince" = CASE "shippingCity"
  WHEN 'تهران' THEN 'تهران'
  WHEN 'مشهد' THEN 'خراسان رضوی'
  WHEN 'اصفهان' THEN 'اصفهان'
  WHEN 'شیراز' THEN 'فارس'
  WHEN 'تبریز' THEN 'آذربایجان شرقی'
  WHEN 'کرج' THEN 'البرز'
  WHEN 'اهواز' THEN 'خوزستان'
  WHEN 'قم' THEN 'قم'
  WHEN 'کرمانشاه' THEN 'کرمانشاه'
  WHEN 'ارومیه' THEN 'آذربایجان غربی'
  WHEN 'رشت' THEN 'گیلان'
  WHEN 'زاهدان' THEN 'سیستان و بلوچستان'
  WHEN 'کرمان' THEN 'کرمان'
  WHEN 'همدان' THEN 'همدان'
  WHEN 'یزد' THEN 'یزد'
  WHEN 'اردبیل' THEN 'اردبیل'
  WHEN 'بندرعباس' THEN 'هرمزگان'
  WHEN 'اراک' THEN 'مرکزی'
  WHEN 'زنجان' THEN 'زنجان'
  WHEN 'قزوین' THEN 'قزوین'
  WHEN 'ساری' THEN 'مازندران'
  WHEN 'گرگان' THEN 'گلستان'
  WHEN 'خرم‌آباد' THEN 'لرستان'
  WHEN 'سنندج' THEN 'کردستان'
  WHEN 'یاسوج' THEN 'کهگیلویه و بویراحمد'
  WHEN 'بجنورد' THEN 'خراسان شمالی'
  WHEN 'بیرجند' THEN 'خراسان جنوبی'
  WHEN 'بوشهر' THEN 'بوشهر'
  WHEN 'ایلام' THEN 'ایلام'
  WHEN 'شهرکرد' THEN 'چهارمحال و بختیاری'
  WHEN 'سمنان' THEN 'سمنان'
  ELSE "shippingCity"
END;

ALTER TABLE "orders" DROP COLUMN "shippingCity";
