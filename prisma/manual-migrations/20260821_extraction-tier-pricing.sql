-- AlterTable
ALTER TABLE "credit_config" ADD COLUMN     "extractionEconomicalCreditCost" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "extractionEconomicalModel" TEXT,
ADD COLUMN     "extractionPremiumCreditCost" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "extractionPremiumModel" TEXT;

