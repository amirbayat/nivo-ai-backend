-- AlterTable
ALTER TABLE "credit_config" ADD COLUMN     "roundingSteps" DOUBLE PRECISION[] DEFAULT ARRAY[0.2, 0.5, 0.8]::DOUBLE PRECISION[];

