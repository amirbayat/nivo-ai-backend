-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'BAZAAR';

-- AlterTable
ALTER TABLE "credit_packages" ADD COLUMN     "bazaarSku" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "credit_packages_bazaarSku_key" ON "credit_packages"("bazaarSku");

