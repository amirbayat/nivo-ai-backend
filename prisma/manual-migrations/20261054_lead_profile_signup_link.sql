-- LS-3: lead-shop signup link (docs/PRD-nivo-lead-shop-seller-signup.md §5.5).
-- Additive and idempotent. MUST RUN BEFORE DEPLOYING the LS-3 backend code (it reads/writes the new columns).
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block — do not wrap this whole file in BEGIN/COMMIT.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "LeadSignupStatus" AS ENUM ('PHONE_SUBMITTED', 'VERIFIED', 'STORE_CREATED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum (admin notification for new lead / signup)
ALTER TYPE "AdminNotificationType" ADD VALUE IF NOT EXISTS 'LEAD_SIGNUP';

-- AlterTable
ALTER TABLE "lead_profiles"
  ADD COLUMN IF NOT EXISTS "conversationId" TEXT,
  ADD COLUMN IF NOT EXISTS "signedUpAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "signupStatus" "LeadSignupStatus",
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT,
  ADD COLUMN IF NOT EXISTS "utmContent" TEXT,
  ADD COLUMN IF NOT EXISTS "utmMedium" TEXT,
  ADD COLUMN IF NOT EXISTS "utmSource" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "lead_profiles_userId_idx" ON "lead_profiles"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "lead_profiles_storeId_conversationId_key" ON "lead_profiles"("storeId", "conversationId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "lead_profiles" ADD CONSTRAINT "lead_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
