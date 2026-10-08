-- Data-only migration (no schema change) — equivalent of running
-- prisma/seeds/demo-template-stores.seed.ts directly against production.
-- Fixes: POST /v2/demo/stores/ensure returning 404 "دموی این دسته‌بندی هنوز
-- آماده نشده" for every category (docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md §۱۹.۲)
-- because these 16 template stores were never seeded on production.
--
-- Idempotent: every INSERT is guarded by "WHERE NOT EXISTS" on the unique
-- slug/phone, so re-running this file (or running it after someone already
-- ran the seed script) is a safe no-op for rows that already exist.

-- Template owner (system/dummy user — phone is never real, isActive=false,
-- so nobody can ever OTP into it). Only sellerId placeholder for the 16
-- template stores (isDemoTemplate=true), never shown to a real visitor.
INSERT INTO "users" (id, phone, "isActive", name, "referralCode", "updatedAt")
SELECT gen_random_uuid()::text, '00000000001', false, 'مالک فروشگاه‌های قالب دمو (سیستمی)', substr(replace(gen_random_uuid()::text, '-', ''), 1, 10), now()
WHERE NOT EXISTS (SELECT 1 FROM "users" WHERE phone = '00000000001');

-- 1) پوشاک
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-clothing', 'فروشگاه نمونه پوشاک', 'پوشاک', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی پوشاک — لباس روزمره و اسپرت با کیفیت مناسب قیمت.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-clothing')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('تیشرت نخی مردانه', 320000, 40, 'تیشرت آستین‌کوتاه نخ پنبه، سایزبندی M تا XL'),
  ('پیراهن زنانه گلدار', 580000, 25, 'پیراهن نخی طرح گلدار، مناسب فصل بهار و تابستان'),
  ('شلوار جین مردانه', 740000, 30, 'شلوار جین اسلیم‌فیت، رنگ آبی تیره'),
  ('هودی اسپرت یونیسکس', 650000, 35, 'هودی کلاه‌دار، پارچه فرنچ‌تری ضخیم')
) AS p(name, base_price, stock, description);

-- 2) کیف و کفش
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-bags-shoes', 'فروشگاه نمونه کیف و کفش', 'کیف و کفش', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی کیف و کفش — تولیدی و وارداتی، گارانتی اصالت.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-bags-shoes')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('کیف دستی زنانه چرم مصنوعی', 890000, 20, 'کیف دستی با دسته بلند قابل تنظیم'),
  ('کفش اسپرت مردانه', 1250000, 18, 'کفش رانینگ سبک، کفی طبی'),
  ('کتونی زنانه سفید', 980000, 22, 'کتونی کلاسیک سفید، مناسب استفاده روزمره'),
  ('کوله‌پشتی دانشجویی', 540000, 28, 'کوله‌پشتی ضدآب با جای لپ‌تاپ')
) AS p(name, base_price, stock, description);

-- 3) آرایشی و بهداشتی
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-cosmetics', 'فروشگاه نمونه آرایشی و بهداشتی', 'آرایشی و بهداشتی', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی لوازم آرایشی و بهداشتی — محصولات اورجینال با کد رهگیری.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-cosmetics')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('کرم مرطوب‌کننده صورت', 420000, 50, 'کرم آبرسان مناسب پوست خشک و معمولی'),
  ('رژ لب مات', 185000, 60, 'رژ لب ماندگار با ۸ رنگ متنوع'),
  ('شامپو تقویت مو', 260000, 45, 'شامپو ضدریزش با عصاره‌ی گیاهی'),
  ('ضدآفتاب SPF50', 395000, 40, 'ضدآفتاب بدون چربی، مناسب زیر آرایش')
) AS p(name, base_price, stock, description);

-- 4) خانه و آشپزخانه
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-home-kitchen', 'فروشگاه نمونه خانه و آشپزخانه', 'خانه و آشپزخانه', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی لوازم خانه و آشپزخانه — کیفیت انتخابی برای زندگی روزمره.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-home-kitchen')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('سرویس قابلمه ۱۲ پارچه', 4200000, 10, 'سرویس قابلمه استیل با پوشش سرامیک'),
  ('اتو بخار', 1450000, 15, 'اتوی بخار قدرتمند با مخزن آب بزرگ'),
  ('چای‌ساز برقی', 980000, 20, 'چای‌ساز دوقوری با دمای قابل‌تنظیم'),
  ('سرویس چاقو آشپزخانه ۶ پارچه', 650000, 25, 'ست چاقوی استیل ضدزنگ با پایه چوبی')
) AS p(name, base_price, stock, description);

-- 5) دیجیتال و لوازم جانبی
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-digital', 'فروشگاه نمونه دیجیتال', 'دیجیتال و لوازم جانبی', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی دیجیتال و لوازم جانبی موبایل — اورجینال و گارانتی‌دار.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-digital')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('هندزفری بلوتوث', 890000, 30, 'هندزفری بی‌سیم با نویزکنسلینگ فعال'),
  ('پاوربانک ۲۰۰۰۰ میلی‌آمپر', 650000, 35, 'پاوربانک فست‌شارژ با دو پورت خروجی'),
  ('قاب گوشی ضدضربه', 185000, 50, 'قاب سیلیکونی ضدضربه، چند مدل گوشی'),
  ('کابل شارژ تایپ-سی', 145000, 60, 'کابل بافته‌شده فست‌شارژ، طول ۱.۵ متر')
) AS p(name, base_price, stock, description);

-- 6) خوراکی و صنایع غذایی
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-food', 'فروشگاه نمونه خوراکی', 'خوراکی و صنایع غذایی', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی خوراکی و صنایع غذایی — محصولات ارگانیک و خانگی.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-food')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('عسل طبیعی چهل‌گیاه', 450000, 25, 'عسل خام بدون شکر، بسته‌بندی یک‌کیلویی'),
  ('آجیل مخلوط برشته', 680000, 20, 'میکس آجیل خام، بسته ۵۰۰ گرمی'),
  ('زعفران سرگل', 920000, 15, 'زعفران درجه یک، بسته ۵ گرمی'),
  ('چای ایرانی ممتاز', 210000, 40, 'چای لاهیجان، بسته ۴۵۰ گرمی')
) AS p(name, base_price, stock, description);

-- 7) کودک و نوزاد
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-kids-baby', 'فروشگاه نمونه کودک و نوزاد', 'کودک و نوزاد', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی کودک و نوزاد — لوازم ایمن و باکیفیت برای کوچولوها.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-kids-baby')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('پوشک بچه سایز ۳', 390000, 30, 'بسته ۴۴ عددی، فوق‌جاذب'),
  ('شیشه شیر ضدنفخ', 220000, 35, 'شیشه شیر ۲۵۰ میلی‌لیتری با سر شیشه سیلیکونی'),
  ('لباس نوزادی نخی', 280000, 25, 'ست سه‌تکه نخی مناسب نوزاد تا ۶ ماه'),
  ('عروسک آموزشی', 340000, 20, 'عروسک نرم با صداهای آموزشی')
) AS p(name, base_price, stock, description);

-- 8) ورزش و سفر
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-sports-travel', 'فروشگاه نمونه ورزش و سفر', 'ورزش و سفر', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی ورزش و سفر — تجهیزات کوهنوردی و سفرهای خانوادگی.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-sports-travel')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('کوله‌پشتی کوهنوردی ۵۰ لیتری', 1650000, 15, 'کوله حرفه‌ای با پوشش ضدآب'),
  ('چادر مسافرتی دو نفره', 2100000, 10, 'چادر سبک ضدآب، نصب سریع'),
  ('کفش کوهنوردی', 1850000, 12, 'کفش ضدآب با کفی ضدلغزش'),
  ('بطری آب ورزشی', 165000, 40, 'بطری عایق‌دار ۷۵۰ میلی‌لیتری')
) AS p(name, base_price, stock, description);

-- 9) جواهرات و اکسسوری
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-jewelry', 'فروشگاه نمونه جواهرات', 'جواهرات و اکسسوری', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی جواهرات و اکسسوری — طراحی مدرن، قیمت منصفانه.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-jewelry')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('گردنبند نقره', 780000, 20, 'گردنبند نقره استرلینگ با پلاک مینیمال'),
  ('دستبند استیل مردانه', 390000, 25, 'دستبند استیل ضدحساسیت و ضدزنگ'),
  ('انگشتر نگین‌دار زنانه', 560000, 18, 'انگشتر روکش طلا با نگین زیرکونیا'),
  ('گوشواره مروارید', 420000, 22, 'گوشواره آویز با مروارید مصنوعی')
) AS p(name, base_price, stock, description);

-- 10) کتاب و لوازم‌التحریر
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-books-stationery', 'فروشگاه نمونه کتاب و لوازم‌التحریر', 'کتاب و لوازم‌التحریر', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی کتاب و لوازم‌التحریر — برای دانش‌آموزان و دانشجویان.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-books-stationery')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('دفتر یادداشت ۱۰۰ برگ', 95000, 60, 'دفتر جلدسخت خط‌دار، صحافی فنری'),
  ('خودکار ژله‌ای رنگی (۱۲ رنگ)', 145000, 50, 'پک ۱۲ عددی خودکار ژله‌ای رنگارنگ'),
  ('کتاب رمان ایرانی', 220000, 30, 'رمان پرفروش نویسندگان معاصر ایرانی'),
  ('پک مداد رنگی ۲۴ عددی', 185000, 35, 'مداد رنگی روغنی با جعبه فلزی')
) AS p(name, base_price, stock, description);

-- 11) گل و گیاه
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-flowers-plants', 'فروشگاه نمونه گل و گیاه', 'گل و گیاه', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی گل و گیاه — گیاهان آپارتمانی و دسته‌گل تازه.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-flowers-plants')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('گلدان ساکولنت', 185000, 25, 'ساکولنت در گلدان سرامیکی کوچک'),
  ('دسته گل رز هلندی', 650000, 15, 'دسته ۲۰ شاخه رز هلندی تازه'),
  ('بذر گل آفتابگردان', 45000, 50, 'بسته بذر آفتابگردان زینتی'),
  ('گیاه آپارتمانی پوتوس', 290000, 20, 'گیاه پوتوس در گلدان پلاستیکی، مناسب فضای داخلی')
) AS p(name, base_price, stock, description);

-- 12) صنایع‌دستی
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-handicrafts', 'فروشگاه نمونه صنایع‌دستی', 'صنایع‌دستی', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی صنایع‌دستی — تولیدات دست‌ساز هنرمندان ایرانی.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-handicrafts')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('تابلو فرش دستباف کوچک', 1450000, 8, 'تابلو فرش دستباف طرح سنتی'),
  ('سفال نقاشی‌شده', 380000, 15, 'گلدان سفالی با نقاشی دست‌ساز'),
  ('رودوشی بافتنی دست‌ساز', 420000, 18, 'شال بافتنی پشمی، بافت دست'),
  ('جعبه چوبی منبت‌کاری', 560000, 12, 'جعبه جواهرات چوبی با طرح منبت')
) AS p(name, base_price, stock, description);

-- 13) حیوانات خانگی
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-pets', 'فروشگاه نمونه حیوانات خانگی', 'حیوانات خانگی', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی لوازم حیوانات خانگی — غذا و اکسسوری سگ و گربه.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-pets')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('غذای خشک گربه', 580000, 25, 'غذای خشک بالغ، بسته ۲ کیلوگرمی'),
  ('قلاده سگ', 220000, 30, 'قلاده قابل‌تنظیم با بند بلند'),
  ('شن بهداشتی گربه', 195000, 35, 'شن بنتونیتی خوشبو، بسته ۵ کیلویی'),
  ('اسباب‌بازی جویدنی سگ', 165000, 40, 'اسباب‌بازی لاستیکی ضدحساسیت')
) AS p(name, base_price, stock, description);

-- 14) دوره آموزشی و محصولات دیجیتال (§۱۹.۵)
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-online-courses', 'فروشگاه نمونه دوره‌های آموزشی', 'دوره آموزشی و محصولات دیجیتال', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی دوره‌های آموزشی آنلاین — ویدیو و فایل قابل‌دانلود، تحویل بعد از تایید سفارش.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-online-courses')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('دوره‌ی جامع مربی‌گری آنلاین', 1450000, 999, 'بیش از ۲۰ ساعت ویدیوی آموزشی + فایل تمرین، دسترسی دائمی'),
  ('پکیج مقدماتی عکاسی با موبایل', 390000, 999, 'آموزش گام‌به‌گام ۸ جلسه‌ای به‌صورت ویدیو'),
  ('قالب آماده صفحه فرود (لندینگ)', 190000, 999, 'فایل Figma + HTML آماده، قابل‌شخصی‌سازی'),
  ('کتاب الکترونیک آموزش فروش دایرکت', 120000, 999, 'فایل PDF، ۸۰ صفحه، ارسال فوری بعد از خرید')
) AS p(name, base_price, stock, description);

-- 15) فرش دستباف و عتیقه (§۱۹.۵)
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-carpets-antiques', 'فروشگاه نمونه فرش و عتیقه', 'فرش دستباف و عتیقه', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی فرش دستباف و اشیای عتیقه — قیمت نهایی بعد از مذاکره در چت.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-carpets-antiques')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('فرش دستباف قشقایی (۶ متری)', 18500000, 3, 'فرش دستباف اصیل، طرح سنتی، قابل‌معاینه حضوری'),
  ('گلیم دستباف کردستان', 4200000, 6, 'گلیم دورو، نخ و رنگ طبیعی'),
  ('ساعت دیواری عتیقه برنجی', 2850000, 2, 'ساعت دیواری قدیمی، کارکرده و اصل، سالم و سرویس‌شده'),
  ('سماور زغالی آنتیک', 3600000, 4, 'سماور قدیمی برنجی، قابل‌استفاده و تزئینی')
) AS p(name, base_price, stock, description);

-- 16) خدمات تعمیر (§۱۹.۵)
WITH new_store AS (
  INSERT INTO "stores" (id, "sellerId", slug, name, category, "bankCardNumber", "bankOwnerName", "brandIntro", "isDemoTemplate", "updatedAt")
  SELECT gen_random_uuid()::text, u.id, 'demo-template-repair-services', 'فروشگاه نمونه خدمات تعمیر', 'خدمات تعمیر', '6037991000000000', 'فروشگاه نمونه نیوو', 'فروشگاه نمونه‌ی تعمیرات موبایل و لوازم خانگی — هزینه‌ی بازدید اولیه، ادامه‌ی قیمت در چت.', true, now()
  FROM "users" u
  WHERE u.phone = '00000000001' AND NOT EXISTS (SELECT 1 FROM "stores" WHERE slug = 'demo-template-repair-services')
  RETURNING id
)
INSERT INTO "products" (id, "storeId", name, "basePrice", stock, description)
SELECT gen_random_uuid()::text, new_store.id, p.name, p.base_price, p.stock, p.description
FROM new_store, (VALUES
  ('هزینه بازدید و عیب‌یابی موبایل', 150000, 999, 'بازدید حضوری/اکسپرس + تشخیص ایراد، قابل‌کسر از هزینه‌ی تعمیر'),
  ('تعویض باتری گوشی (قطعه اورجینال)', 650000, 999, 'شامل باتری + نصب، گارانتی ۳ ماهه'),
  ('تعمیر صفحه نمایش گوشی', 1200000, 999, 'قیمت پایه برای مدل‌های پرتقاضا، نهایی بعد از دیدن دستگاه'),
  ('سرویس و تعمیر لباسشویی', 400000, 999, 'هزینه اعزام تکنسین + بازدید، قطعه جدا محاسبه می‌شود')
) AS p(name, base_price, stock, description);
