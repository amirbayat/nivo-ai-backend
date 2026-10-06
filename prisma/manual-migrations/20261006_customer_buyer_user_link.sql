-- docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۴.۲ — هویت پایدار خریدار (فاز ۱)
-- additive، بدون data loss: userId نال‌پذیر است (پیش‌فرض null یعنی این Customer هنوز به هیچ
-- User ای وصل نشده)؛ ON DELETE SET NULL یعنی حذف یک User هیچ‌وقت Customer را حذف نمی‌کند.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "customers_userId_idx" ON "customers"("userId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
