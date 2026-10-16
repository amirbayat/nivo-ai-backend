-- CreateEnum
CREATE TYPE "LeadSignupStatus" AS ENUM ('PHONE_SUBMITTED', 'VERIFIED', 'STORE_CREATED');

-- AlterTable
ALTER TABLE "lead_profiles" ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "signedUpAt" TIMESTAMP(3),
ADD COLUMN     "signupStatus" "LeadSignupStatus",
ADD COLUMN     "userId" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT;

-- CreateIndex
CREATE INDEX "lead_profiles_userId_idx" ON "lead_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_profiles_storeId_conversationId_key" ON "lead_profiles"("storeId", "conversationId");

-- AddForeignKey
ALTER TABLE "lead_profiles" ADD CONSTRAINT "lead_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

