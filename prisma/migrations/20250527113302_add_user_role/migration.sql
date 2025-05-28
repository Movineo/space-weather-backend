-- DropForeignKey
ALTER TABLE "Alert" DROP CONSTRAINT "Alert_userId_fkey";

-- DropForeignKey
ALTER TABLE "AlertDelivery" DROP CONSTRAINT "AlertDelivery_phoneNumber_fkey";

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "level" TEXT;

-- AlterTable
ALTER TABLE "AlertDelivery" ALTER COLUMN "receivedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" TEXT DEFAULT 'general',
ALTER COLUMN "subscribed" SET DEFAULT false;
