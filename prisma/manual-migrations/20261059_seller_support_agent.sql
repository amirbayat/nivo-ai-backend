-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('GENERAL', 'SELLER');

-- CreateEnum
CREATE TYPE "TicketChannel" AS ENUM ('WEB', 'SELLER_BOT');

-- CreateEnum
CREATE TYPE "SupportMessageRole" AS ENUM ('SELLER', 'ASSISTANT', 'ADMIN');

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "aiSummary" TEXT,
ADD COLUMN     "category" "TicketCategory" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "channel" "TicketChannel" NOT NULL DEFAULT 'WEB',
ADD COLUMN     "storeId" TEXT;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "lastSupportNudgeAt" TIMESTAMP(3),
ADD COLUMN     "supportNudgesEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "support_docs" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_support_messages" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "role" "SupportMessageRole" NOT NULL,
    "body" TEXT NOT NULL,
    "ticketId" TEXT,
    "model" TEXT,
    "costToman" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_docs_slug_key" ON "support_docs"("slug");

-- CreateIndex
CREATE INDEX "seller_support_messages_storeId_createdAt_idx" ON "seller_support_messages"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_category_status_createdAt_idx" ON "support_tickets"("category", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_support_messages" ADD CONSTRAINT "seller_support_messages_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
