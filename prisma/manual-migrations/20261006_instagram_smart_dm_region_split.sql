-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('COMMENT_KEYWORD', 'STORY_REPLY', 'STORY_MENTION', 'DM_KEYWORD');

-- AlterEnum
ALTER TYPE "CustomerChannel" ADD VALUE 'INSTAGRAM';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email" TEXT,
ALTER COLUMN "phone" DROP NOT NULL;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "instagramAccessToken" TEXT,
ADD COLUMN     "instagramBusinessId" TEXT,
ADD COLUMN     "instagramConnectedAt" TIMESTAMP(3),
ADD COLUMN     "instagramTokenExpiresAt" TIMESTAMP(3),
ALTER COLUMN "bankCardNumber" DROP NOT NULL,
ALTER COLUMN "bankOwnerName" DROP NOT NULL;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "instagramPsid" TEXT;

-- CreateTable
CREATE TABLE "instagram_automation_rules" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "targetMediaId" TEXT,
    "keyword" TEXT,
    "staticReplyText" TEXT,
    "staticDmText" TEXT NOT NULL,
    "publicReplyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instagram_automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instagram_automation_rules_storeId_isActive_idx" ON "instagram_automation_rules"("storeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "stores_instagramBusinessId_key" ON "stores"("instagramBusinessId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_storeId_instagramPsid_key" ON "customers"("storeId", "instagramPsid");

-- AddForeignKey
ALTER TABLE "instagram_automation_rules" ADD CONSTRAINT "instagram_automation_rules_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

