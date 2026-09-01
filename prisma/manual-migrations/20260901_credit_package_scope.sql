-- CreateEnum
CREATE TYPE "CreditPackageScope" AS ENUM ('GENERAL', 'NIVO_CAL');

-- AlterTable
ALTER TABLE "credit_packages" ADD COLUMN     "scope" "CreditPackageScope" NOT NULL DEFAULT 'GENERAL';

