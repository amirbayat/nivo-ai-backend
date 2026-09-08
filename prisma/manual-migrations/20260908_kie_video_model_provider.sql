-- CreateEnum
CREATE TYPE "VideoModelProvider" AS ENUM ('KIE', 'OPENROUTER');

-- AlterTable
ALTER TABLE "kie_video_models" ADD COLUMN     "provider" "VideoModelProvider" NOT NULL DEFAULT 'KIE';
