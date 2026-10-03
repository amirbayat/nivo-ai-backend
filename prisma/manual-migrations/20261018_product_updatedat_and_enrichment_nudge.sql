-- docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۹ (فاز ۴.۴) — غنی‌سازی دوره‌ای.
-- Product تا امروز هیچ timestamp آپدیتی نداشت، پس نمی‌شد تشخیص داد یک محصول «مدت‌هاست
-- دست‌نخورده» مانده. Store.lastEnrichmentNudgeAt هم برای جلوگیری از اسپم تلگرامی یادآوری
-- (cron فقط فروشگاه‌هایی که این فیلدشان خالی یا قدیمی است را دوباره نوتیف می‌کند) لازم است.
-- هر دو additive و nullable/با-دیفالت هستند — بدون ریسک از دست رفتن داده، بدون بک‌فیل دستی.

ALTER TABLE "stores" ADD COLUMN "lastEnrichmentNudgeAt" TIMESTAMP(3);

ALTER TABLE "products" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
