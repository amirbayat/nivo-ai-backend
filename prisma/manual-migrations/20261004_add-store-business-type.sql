-- CreateEnum
CREATE TYPE "StoreBusinessType" AS ENUM ('PRODUCT_SALES', 'APPOINTMENT_BOOKING');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "businessType" "StoreBusinessType" NOT NULL DEFAULT 'PRODUCT_SALES';

