-- CreateTable
CREATE TABLE "creative_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creative_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creative_categories_parentId_sortOrder_idx" ON "creative_categories"("parentId", "sortOrder");

-- AddForeignKey
ALTER TABLE "creative_categories" ADD CONSTRAINT "creative_categories_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "creative_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: creative_prompts گیرنده‌ی categoryId جدید (nullable — سازگار عقب‌رو با segment قدیمی)
ALTER TABLE "creative_prompts" ADD COLUMN "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "creative_prompts_categoryId_idx" ON "creative_prompts"("categoryId");

-- AddForeignKey
ALTER TABLE "creative_prompts" ADD CONSTRAINT "creative_prompts_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "creative_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
