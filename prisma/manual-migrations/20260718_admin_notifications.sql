-- CreateEnum
CREATE TYPE "AdminNotificationType" AS ENUM ('PAYMENT_COMPLETED', 'WALLET_TOPUP_COMPLETED', 'TICKET_CREATED', 'SYSTEM_ERROR_SPIKE', 'LIARA_ERROR_RATE');

-- CreateTable
CREATE TABLE "admin_notifications" (
    "id" TEXT NOT NULL,
    "type" "AdminNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "readBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_device_tokens" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_notifications_createdAt_idx" ON "admin_notifications"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "admin_device_tokens_token_key" ON "admin_device_tokens"("token");

-- CreateIndex
CREATE INDEX "admin_device_tokens_adminId_idx" ON "admin_device_tokens"("adminId");

-- AddForeignKey
ALTER TABLE "admin_device_tokens" ADD CONSTRAINT "admin_device_tokens_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

