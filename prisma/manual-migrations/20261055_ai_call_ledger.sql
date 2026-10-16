-- ACE-0: ledger هزینه‌ی AI (docs/PRD-ai-cost-engine-2026-10-16.md). Additive و idempotent.
-- اجرا قبل یا بعد از دیپلوی؛ تا اجرا نشود ledger بی‌صدا ثبت نمی‌کند (فقط یک warning).
CREATE TABLE IF NOT EXISTS "ai_call_ledger" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "storeId" TEXT,
  "conversationId" TEXT,
  "turnId" TEXT,
  "callSite" TEXT NOT NULL,
  "servedBy" TEXT NOT NULL,
  "model" TEXT,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
  "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
  "steps" INTEGER NOT NULL DEFAULT 0,
  "costUsdMicros" INTEGER NOT NULL DEFAULT 0,
  "costIsEstimate" BOOLEAN NOT NULL DEFAULT false,
  "avoidedUsdMicros" INTEGER NOT NULL DEFAULT 0,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "meta" JSONB,
  CONSTRAINT "ai_call_ledger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_call_ledger_createdAt_idx" ON "ai_call_ledger"("createdAt");
CREATE INDEX IF NOT EXISTS "ai_call_ledger_storeId_createdAt_idx" ON "ai_call_ledger"("storeId", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_call_ledger_callSite_createdAt_idx" ON "ai_call_ledger"("callSite", "createdAt");
