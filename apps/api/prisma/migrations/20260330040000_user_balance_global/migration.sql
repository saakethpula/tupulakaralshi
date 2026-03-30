-- AlterTable
ALTER TABLE "User"
ADD COLUMN "balance" INTEGER NOT NULL DEFAULT 0;

-- Copy existing group balances into user balances using each user's highest current balance.
UPDATE "User"
SET "balance" = COALESCE(balances."balance", 0)
FROM (
  SELECT "userId", MAX("balance") AS "balance"
  FROM "GroupMembership"
  GROUP BY "userId"
) AS balances
WHERE balances."userId" = "User"."id";

-- AlterTable
ALTER TABLE "GroupMembership"
DROP COLUMN "balance";
