-- AlterTable
ALTER TABLE "User" ADD COLUMN     "email" TEXT,
ALTER COLUMN "location" DROP NOT NULL,
ALTER COLUMN "preferences" DROP DEFAULT;
