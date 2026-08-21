-- تاریخچه‌ی چت الان تولیدهای دیسکاوری (استفاده از سبک/استودیو) رو نشون نمی‌ده چون
-- CreativeGeneration هیچ لینکی به Conversation نداشت — این ستون additive و نال‌پذیر است،
-- رفتار قبلی (تولید بدون conversationId، مثل حالت مهمان/anon) دست‌نخورده می‌ماند.

-- AlterTable
ALTER TABLE "creative_generations" ADD COLUMN     "conversationId" TEXT;

-- CreateIndex
CREATE INDEX "creative_generations_conversationId_createdAt_idx" ON "creative_generations"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "creative_generations" ADD CONSTRAINT "creative_generations_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
