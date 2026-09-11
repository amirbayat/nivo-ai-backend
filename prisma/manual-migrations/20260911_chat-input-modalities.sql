-- docs/PRD-chat-input-modalities-and-web-search.md
-- Per-model input flags + chat video/audio size caps.
-- Run this on production Postgres yourself. Do not prisma db push.

ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "supportsFileInput" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "supportsVideoInput" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "supportsAudioInput" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "chat_config" ADD COLUMN IF NOT EXISTS "maxVideoSizeMb" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "chat_config" ADD COLUMN IF NOT EXISTS "maxAudioSizeMb" INTEGER NOT NULL DEFAULT 10;
