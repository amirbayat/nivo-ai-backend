-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "contextSummarizedAt" TIMESTAMP(3),
ADD COLUMN     "contextSummary" TEXT;

-- AlterTable
ALTER TABLE "chat_config" ADD COLUMN     "projectContextMaxChars" INTEGER NOT NULL DEFAULT 3000;

-- CreateIndex
CREATE INDEX "conversations_projectId_lastMessageAt_idx" ON "conversations"("projectId", "lastMessageAt" DESC);

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

