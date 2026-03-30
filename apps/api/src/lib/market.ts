import type { Market, Position, PositionSide, PositionStatus } from "@prisma/client";

type PositionLike = Pick<Position, "userId" | "side" | "amount" | "status">;

export function filterConfirmedPositions<T extends PositionLike>(positions: T[]) {
  return positions.filter((position) => position.status === "CONFIRMED");
}

export function filterPendingPositions<T extends PositionLike>(positions: T[]) {
  return positions.filter((position) => position.status === "PENDING");
}

export function calculateMarketSummary(market: Market, positions: PositionLike[]) {
  const yesVolume = positions
    .filter((position) => position.side === "YES")
    .reduce((total, position) => total + position.amount, 0);
  const noVolume = positions
    .filter((position) => position.side === "NO")
    .reduce((total, position) => total + position.amount, 0);
  const totalVolume = yesVolume + noVolume;
  const yesPrice =
    totalVolume === 0 ? 0.5 : Number((yesVolume / totalVolume).toFixed(2));

  return {
    yesVolume,
    noVolume,
    totalVolume,
    yesPrice,
    noPrice: Number((1 - yesPrice).toFixed(2)),
    leadingSide: yesVolume >= noVolume ? "YES" : "NO"
  };
}

export function calculateUserPosition(
  positions: PositionLike[],
  userId: string,
  status?: PositionStatus
) {
  const userPositions = positions.filter((position) => position.userId === userId);
  const scopedPositions =
    status === undefined
      ? userPositions
      : userPositions.filter((position) => position.status === status);
  const yesAmount = scopedPositions
    .filter((position) => position.side === "YES")
    .reduce((total, position) => total + position.amount, 0);
  const noAmount = scopedPositions
    .filter((position) => position.side === "NO")
    .reduce((total, position) => total + position.amount, 0);
  const totalAmount = yesAmount + noAmount;

  return {
    yesAmount,
    noAmount,
    totalAmount
  };
}

export function calculateResolutionPayouts(
  positions: PositionLike[],
  resolution: boolean | null | undefined
) {
  const payouts = new Map<string, number>();
  const totalPot = positions.reduce((total, position) => total + position.amount, 0);

  if (!resolution && resolution !== false) {
    return payouts;
  }

  if (totalPot === 0) {
    return payouts;
  }

  const winningSide: PositionSide = resolution ? "YES" : "NO";
  const winningPositions = positions.filter((position) => position.side === winningSide);
  const winningTotal = winningPositions.reduce((total, position) => total + position.amount, 0);

  if (winningTotal === 0) {
    for (const position of positions) {
      payouts.set(position.userId, (payouts.get(position.userId) ?? 0) + position.amount);
    }

    return payouts;
  }

  const rawShares = winningPositions.map((position) => {
    const exact = (totalPot * position.amount) / winningTotal;
    const payout = Math.floor(exact);

    return {
      userId: position.userId,
      payout,
      remainder: exact - payout
    };
  });

  let distributed = rawShares.reduce((total, share) => total + share.payout, 0);
  const remainderPool = totalPot - distributed;

  rawShares
    .sort((left, right) => right.remainder - left.remainder)
    .forEach((share, index) => {
      const bonus = index < remainderPool ? 1 : 0;
      payouts.set(share.userId, (payouts.get(share.userId) ?? 0) + share.payout + bonus);
      distributed += bonus;
    });

  return payouts;
}
