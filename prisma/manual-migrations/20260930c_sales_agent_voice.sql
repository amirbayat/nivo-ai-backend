-- docs/PRD-sales-agent-voice.md بخش ۴ — سقف تعداد وویس به‌ازای هر مکالمه (additive, safe)

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN "voiceGenerationCount" INTEGER NOT NULL DEFAULT 0;
