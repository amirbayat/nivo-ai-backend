-- docs/PRD-admin-credit-reports.md بخش ۲ — تفکیک خرید بسته‌ی نیوو از شارژ دستی PAYG قدیمی
-- در گزارش‌های ادمین. additive و نال‌پذیر — هیچ رفتار پرداخت/کیف‌پول موجود را تغییر نمی‌دهد؛
-- رکوردهای Payment قدیمی همه packageId/credits=NULL می‌مانند (که درست است، چون بسته‌ای نداشتند).
-- credits = تعداد نیووی خریداری‌شده در همان Payment (snapshot لحظه‌ی خرید، برای بسته‌ی
-- isCustomAmount قابل بازمحاسبه‌ی دقیق از amount نیست چون config می‌تواند بعداً تغییر کند).

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "credits" INTEGER,
ADD COLUMN     "packageId" TEXT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "credit_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
