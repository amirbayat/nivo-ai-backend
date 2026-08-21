-- AlterTable
ALTER TABLE "credit_config" ALTER COLUMN "defaultExtractedPromptCreditCost" SET DEFAULT 16,
ALTER COLUMN "sourceImageAccuracyCreditCost" SET DEFAULT 4;

-- تصمیم محصول: قیمت تولید عکس استودیو ۱۶ نیوو، با سوییچ «استفاده از عکس اصلی» ۲۰ نیوو
-- (۱۶ + ۴) — روی رکورد singleton موجود هم اعمال می‌شود، نه فقط دیفالت ردیف‌های آینده
UPDATE "credit_config" SET
  "defaultExtractedPromptCreditCost" = 16,
  "sourceImageAccuracyCreditCost" = 4
WHERE id = 'singleton';
