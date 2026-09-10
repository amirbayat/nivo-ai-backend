-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VideoModelProvider" ADD VALUE 'VEO';
ALTER TYPE "VideoModelProvider" ADD VALUE 'RUNWAY';

-- DropForeignKey
ALTER TABLE "studio_projects" DROP CONSTRAINT "studio_projects_userId_fkey";

-- DropForeignKey
ALTER TABLE "studio_messages" DROP CONSTRAINT "studio_messages_projectId_fkey";

-- DropForeignKey
ALTER TABLE "studio_character_options" DROP CONSTRAINT "studio_character_options_projectId_fkey";

-- DropForeignKey
ALTER TABLE "studio_shots" DROP CONSTRAINT "studio_shots_projectId_fkey";

-- AlterTable
ALTER TABLE "kie_video_models" ADD COLUMN     "inputFields" JSONB;

-- AlterTable
ALTER TABLE "video_edit_jobs" ADD COLUMN     "kieState" TEXT,
ADD COLUMN     "progressPercent" INTEGER,
ADD COLUMN     "valuesJson" JSONB;

-- DropTable
DROP TABLE "video_studio_config";

-- DropTable
DROP TABLE "studio_projects";

-- DropTable
DROP TABLE "studio_messages";

-- DropTable
DROP TABLE "studio_character_options";

-- DropTable
DROP TABLE "studio_shots";

-- DropEnum
DROP TYPE "StudioProjectStatus";

-- DropEnum
DROP TYPE "StudioShotVideoStatus";

-- DropEnum
DROP TYPE "StudioModerationStatus";

