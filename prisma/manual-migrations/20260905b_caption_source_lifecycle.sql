-- AlterTable
ALTER TABLE "caption_projects" ADD COLUMN     "debugAudioKey" TEXT,
ADD COLUMN     "sourceDeletedAt" TIMESTAMP(3),
ADD COLUMN     "sourceHeight" INTEGER,
ADD COLUMN     "sourceWidth" INTEGER;

