-- فقط تشخیصی — هیچ‌چیزی را تغییر نمی‌دهد. برای فهمیدن اینکه مایگریشن قبلی
-- (20260709_rial_to_toman.sql) چقدرش واقعاً اجرا شده، این را اجرا کن و نتیجه‌اش را بفرست.

-- ۱. آیا ستون‌ها rename شده‌اند؟
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('costRial', 'costToman', 'balanceRial', 'balanceToman',
                      'amountRial', 'amountToman', 'dailyBudgetRial', 'dailyBudgetToman')
ORDER BY table_name, column_name;

-- ۲. آیا مقادیر priceMonthly تقسیم بر ۱۰ شده‌اند؟ (باید ۱۹۹۰۰۰ نه ۱۹۹۰۰۰۰ باشه)
SELECT name, "priceMonthly" FROM plans ORDER BY "sortOrder";

-- ۳. نمونه از payments.amount (اگر ردیفی هست)
SELECT amount FROM payments ORDER BY "createdAt" DESC LIMIT 5;
