-- video-edit redesign (۱۴۰۵/۰۶/۱۷): مفهوم Session + پشتیبانی چند input-schema روی KieVideoModel.
-- سه‌مرحله‌ای برای sessionId چون video_edit_jobs ممکن است ردیف موجود (پروداکشن) داشته باشد —
-- افزودن مستقیم NOT NULL بدون backfill خطا می‌دهد.

-- ── ۱) جدول video_edit_sessions (بدون وابستگی به video_edit_jobs) ──
CREATE TABLE "video_edit_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_edit_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "video_edit_sessions_userId_idx" ON "video_edit_sessions"("userId");

ALTER TABLE "video_edit_sessions" ADD CONSTRAINT "video_edit_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ۲) ستون sessionId روی video_edit_jobs — ابتدا nullable ──
ALTER TABLE "video_edit_jobs" ADD COLUMN "sessionId" TEXT;

-- ── ۳) Backfill: هر job قدیمی بدون session یک session تک‌عضوی می‌گیرد (عنوان از ۴۰ کاراکتر اول prompt) ──
DO $$
DECLARE
  job RECORD;
  new_session_id TEXT;
BEGIN
  FOR job IN SELECT id, "userId", prompt, "createdAt" FROM "video_edit_jobs" WHERE "sessionId" IS NULL LOOP
    new_session_id := gen_random_uuid()::text;
    INSERT INTO "video_edit_sessions" ("id", "userId", "title", "createdAt")
    VALUES (new_session_id, job."userId", left(job.prompt, 40), job."createdAt");
    UPDATE "video_edit_jobs" SET "sessionId" = new_session_id WHERE id = job.id;
  END LOOP;
END $$;

-- ── ۴) حالا که همه‌ی ردیف‌ها پر شدند: NOT NULL + ایندکس + FK ──
ALTER TABLE "video_edit_jobs" ALTER COLUMN "sessionId" SET NOT NULL;
CREATE INDEX "video_edit_jobs_sessionId_idx" ON "video_edit_jobs"("sessionId");
ALTER TABLE "video_edit_jobs" ADD CONSTRAINT "video_edit_jobs_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "video_edit_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ۵) KieVideoModel: پشتیبانی چند input-schema (مستقل از تغییرات بالا) ──
CREATE TYPE "KieInputSchema" AS ENUM ('OMNI', 'SEEDANCE', 'WAN_V2V', 'WAN_R2V', 'WAN_VIDEO_EDIT');

ALTER TABLE "kie_video_models"
  ADD COLUMN "fixedDurations" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "kieInputSchema" "KieInputSchema" NOT NULL DEFAULT 'OMNI',
  ADD COLUMN "supportsScenePreservingEdit" BOOLEAN NOT NULL DEFAULT false;

-- Omni از قبل واقعاً edit صحنه‌حفظ‌کننده دارد (تنها مدل موجود قبل از این بازطراحی) — این پرچم
-- را برایش صریح روشن می‌کنیم تا رفتار موجودش بعد از این migration عوض نشود
UPDATE "kie_video_models" SET "supportsScenePreservingEdit" = true WHERE "slug" = 'gemini-omni-video';
