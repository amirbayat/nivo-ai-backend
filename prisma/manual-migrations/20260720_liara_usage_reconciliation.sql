-- CreateTable
CREATE TABLE "liara_api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyName" TEXT NOT NULL,
    "encryptedKey" TEXT NOT NULL,
    "liaraKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liara_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liara_usage_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "realTokensTotal" INTEGER NOT NULL DEFAULT 0,
    "realCostToman" INTEGER NOT NULL DEFAULT 0,
    "realTextCostToman" INTEGER NOT NULL DEFAULT 0,
    "realImageCostToman" INTEGER NOT NULL DEFAULT 0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liara_usage_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "liara_api_keys_userId_key" ON "liara_api_keys"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "liara_api_keys_keyName_key" ON "liara_api_keys"("keyName");

-- CreateIndex
CREATE INDEX "liara_usage_snapshots_date_idx" ON "liara_usage_snapshots"("date");

-- CreateIndex
CREATE UNIQUE INDEX "liara_usage_snapshots_userId_date_key" ON "liara_usage_snapshots"("userId", "date");

-- AddForeignKey
ALTER TABLE "liara_api_keys" ADD CONSTRAINT "liara_api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liara_usage_snapshots" ADD CONSTRAINT "liara_usage_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

