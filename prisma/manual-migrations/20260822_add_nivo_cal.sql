-- AlterTable
ALTER TABLE "credit_config" ADD COLUMN     "nivoCalScanCreditCost" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "food_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imageStorageKey" TEXT NOT NULL,
    "note" TEXT,
    "resultJson" JSONB NOT NULL,
    "totalCalories" INTEGER NOT NULL,
    "healthScore" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "costToman" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "food_logs_userId_createdAt_idx" ON "food_logs"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "food_logs" ADD CONSTRAINT "food_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
