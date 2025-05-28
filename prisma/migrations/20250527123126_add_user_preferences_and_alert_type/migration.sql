-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "type" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferences" JSONB DEFAULT '{}';
