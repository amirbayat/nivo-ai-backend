-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "mediaReviewFollowUpSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "product_comments" ADD COLUMN     "audioKey" TEXT,
ADD COLUMN     "imageKey" TEXT,
ADD COLUMN     "videoKey" TEXT;

-- CreateIndex
CREATE INDEX "orders_status_mediaReviewFollowUpSentAt_idx" ON "orders"("status", "mediaReviewFollowUpSentAt");

