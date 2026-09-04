-- CreateTable
CREATE TABLE "studio_messages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "intent" TEXT,
    "suggestedActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "studio_messages_projectId_createdAt_idx" ON "studio_messages"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "studio_messages" ADD CONSTRAINT "studio_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

