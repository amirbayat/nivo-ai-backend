-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('FIXED', 'WEIGHT_BASED_FORMULA');

-- CreateEnum
CREATE TYPE "GoldWageType" AS ENUM ('PERCENT', 'FIXED_PER_GRAM');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "goldProfitPercent" DOUBLE PRECISION,
ADD COLUMN     "goldVatPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
ADD COLUMN     "goldWageType" "GoldWageType",
ADD COLUMN     "goldWageValue" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "pricingModel" "PricingModel" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "purityKarat" INTEGER,
ADD COLUMN     "weightGrams" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "purityKarat" INTEGER,
ADD COLUMN     "weightGrams" DOUBLE PRECISION;

