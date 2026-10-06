-- docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۶ — اکشن کاستوم «فقط لید»
-- برای فروشگاه دموی خودِ فروشنده. additive، بدون data loss: leadCaptureOnly پیش‌فرض false
-- (رفتار فعلی همه‌ی فروشگاه‌ها دست‌نخورده می‌ماند)، lead_profiles.storeId هم nullable
-- (لیدهای قدیمی صفحه‌ی قیمت‌گذاری همچنان null می‌مانند).
-- AlterTable
ALTER TABLE "lead_profiles" ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "leadCaptureOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "lead_profiles_storeId_idx" ON "lead_profiles"("storeId");

-- AddForeignKey
ALTER TABLE "lead_profiles" ADD CONSTRAINT "lead_profiles_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

