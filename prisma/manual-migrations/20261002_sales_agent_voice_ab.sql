-- docs/PRD-sales-agent-voice.md بخش ۶.۱ — A/B تست وویس در برابر فقط-متن (additive, safe)

-- CreateEnum
CREATE TYPE "VoiceVariant" AS ENUM ('ON', 'OFF');

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "voiceVariant" "VoiceVariant" NOT NULL DEFAULT 'ON';

