-- docs/PRD-sales-agent-voice.md بخش ۶.۳ — شمارنده‌ی وویس‌های پشت‌سرهم (جدا از
-- voiceGenerationCount که سقف کل مکالمه است). کاملاً additive.

-- AlterTable
ALTER TABLE "sales_conversations" ADD COLUMN     "consecutiveVoiceReplyCount" INTEGER NOT NULL DEFAULT 0;
