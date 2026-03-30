-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('PENDING', 'CONFIRMED');

-- AlterTable
ALTER TABLE "Position"
ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "status" "PositionStatus" NOT NULL DEFAULT 'PENDING';
