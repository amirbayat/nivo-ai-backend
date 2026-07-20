
-- CreateTable
CREATE TABLE "liara_key_provisioning_issues" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastError" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liara_key_provisioning_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "liara_key_provisioning_issues_userId_key" ON "liara_key_provisioning_issues"("userId");

-- AddForeignKey
ALTER TABLE "liara_key_provisioning_issues" ADD CONSTRAINT "liara_key_provisioning_issues_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

