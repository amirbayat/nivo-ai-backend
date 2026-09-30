-- CreateEnum
CREATE TYPE "CardDisplayPolicy" AS ENUM ('THRESHOLD', 'PERCENTAGE', 'EQUAL');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "cardDisplayPolicy" "CardDisplayPolicy" NOT NULL DEFAULT 'EQUAL',
ADD COLUMN     "lastCardIndex" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "bankCardId" TEXT;

-- CreateTable
CREATE TABLE "store_bank_cards" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "thresholdToman" INTEGER,
    "percentWeight" INTEGER,
    "totalConfirmedToman" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_bank_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_bank_cards_storeId_isActive_idx" ON "store_bank_cards"("storeId", "isActive");

-- AddForeignKey
ALTER TABLE "store_bank_cards" ADD CONSTRAINT "store_bank_cards_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_bankCardId_fkey" FOREIGN KEY ("bankCardId") REFERENCES "store_bank_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data backfill: هر فروشگاه موجود یک StoreBankCard اولیه از bankCardNumber/bankOwnerName
-- فعلی‌اش می‌گیرد (docs/PRD-seller-multi-bank-card-rotation.md بخش ۱) — bankCardNumber/
-- bankOwnerName قدیمی روی Store حذف نمی‌شوند، فقط از این به بعد فقط به‌عنوان fallback
-- دفاعی خوانده می‌شوند (CardSelectorService)
INSERT INTO "store_bank_cards" ("id", "storeId", "cardNumber", "ownerName", "isActive", "sortOrder", "totalConfirmedToman", "createdAt")
SELECT gen_random_uuid(), "id", "bankCardNumber", "bankOwnerName", true, 0, 0, now()
FROM "stores";

