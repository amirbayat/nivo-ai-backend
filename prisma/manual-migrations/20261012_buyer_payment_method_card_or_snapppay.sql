-- CreateEnum
CREATE TYPE "OrderPaymentMethod" AS ENUM ('CARD_TO_CARD', 'SNAPPPAY');

-- AlterEnum
ALTER TYPE "ConversationState" ADD VALUE 'PAYMENT_METHOD_SELECTION';

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "snapppayPaymentLink" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paymentMethod" "OrderPaymentMethod" NOT NULL DEFAULT 'CARD_TO_CARD',
ADD COLUMN     "snapppayTrackingCode" TEXT;

