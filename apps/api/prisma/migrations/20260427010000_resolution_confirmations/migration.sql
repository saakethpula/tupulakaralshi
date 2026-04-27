ALTER TYPE "MarketStatus" ADD VALUE 'PENDING_RESOLUTION';

ALTER TABLE "Market"
ADD COLUMN "resolutionProposedByUserId" TEXT,
ADD COLUMN "resolutionProposedAt" TIMESTAMP(3);

ALTER TABLE "Market"
ADD CONSTRAINT "Market_resolutionProposedByUserId_fkey"
FOREIGN KEY ("resolutionProposedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MarketResolutionConfirmation" (
  "id" TEXT NOT NULL,
  "marketId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketResolutionConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketResolutionConfirmation_marketId_userId_key"
ON "MarketResolutionConfirmation"("marketId", "userId");

CREATE INDEX "MarketResolutionConfirmation_marketId_idx"
ON "MarketResolutionConfirmation"("marketId");

CREATE INDEX "MarketResolutionConfirmation_userId_idx"
ON "MarketResolutionConfirmation"("userId");

ALTER TABLE "MarketResolutionConfirmation"
ADD CONSTRAINT "MarketResolutionConfirmation_marketId_fkey"
FOREIGN KEY ("marketId") REFERENCES "Market"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketResolutionConfirmation"
ADD CONSTRAINT "MarketResolutionConfirmation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
