import type { Position, PositionSide, PositionStatus } from "@prisma/client";

export type OutcomeLike = {
  id: string;
  label: string;
  sortOrder: number;
};

type PositionLike = Pick<Position, "userId" | "amount" | "status"> & {
  side?: PositionSide | null;
  outcomeId?: string | null;
};

const LEGACY_OUTCOMES: OutcomeLike[] = [
  { id: "YES", label: "YES", sortOrder: 0 },
  { id: "NO", label: "NO", sortOrder: 1 }
];

function getPositionOutcomeId(position: PositionLike) {
  return position.outcomeId ?? position.side ?? "";
}

function getOrderedOutcomes(outcomes?: OutcomeLike[]) {
  return [...(outcomes && outcomes.length > 0 ? outcomes : LEGACY_OUTCOMES)].sort(
    (left, right) => left.sortOrder - right.sortOrder
  );
}

export function filterConfirmedPositions<T extends PositionLike>(positions: T[]) {
  return positions.filter((position) => position.status === "CONFIRMED");
}

export function filterPendingPositions<T extends PositionLike>(positions: T[]) {
  return positions.filter((position) => position.status === "PENDING");
}

export function calculateMarketSummary(positions: PositionLike[], outcomes?: OutcomeLike[]) {
  const orderedOutcomes = getOrderedOutcomes(outcomes);
  const totalVolume = positions.reduce((total, position) => total + position.amount, 0);
  const outcomeSummaries = orderedOutcomes.map((outcome) => {
    const volume = positions
      .filter((position) => getPositionOutcomeId(position) === outcome.id)
      .reduce((total, position) => total + position.amount, 0);

    return {
      id: outcome.id,
      label: outcome.label,
      volume,
      price: totalVolume === 0 ? Number((1 / orderedOutcomes.length).toFixed(2)) : Number((volume / totalVolume).toFixed(2))
    };
  });
  const leadingOutcome =
    outcomeSummaries.length === 0
      ? { id: "YES", label: "YES", volume: 0, price: 0.5 }
      : outcomeSummaries.reduce((leader, outcome) => (outcome.volume > leader.volume ? outcome : leader), outcomeSummaries[0]);
  const yesOutcome = outcomeSummaries.find((outcome) => outcome.label.toUpperCase() === "YES");
  const noOutcome = outcomeSummaries.find((outcome) => outcome.label.toUpperCase() === "NO");

  return {
    outcomes: outcomeSummaries,
    yesVolume: yesOutcome?.volume ?? 0,
    noVolume: noOutcome?.volume ?? 0,
    totalVolume,
    yesPrice: yesOutcome?.price ?? 0,
    noPrice: noOutcome?.price ?? 0,
    leadingSide: leadingOutcome.label,
    leadingOutcome
  };
}

export function calculateUserPosition(
  positions: PositionLike[],
  userId: string,
  outcomes?: OutcomeLike[],
  status?: PositionStatus
) {
  const orderedOutcomes = getOrderedOutcomes(outcomes);
  const userPositions = positions.filter((position) => position.userId === userId);
  const scopedPositions =
    status === undefined
      ? userPositions
      : userPositions.filter((position) => position.status === status);
  const outcomeAmounts = orderedOutcomes.map((outcome) => ({
    id: outcome.id,
    label: outcome.label,
    amount: scopedPositions
      .filter((position) => getPositionOutcomeId(position) === outcome.id)
      .reduce((total, position) => total + position.amount, 0)
  }));
  const yesAmount = outcomeAmounts.find((outcome) => outcome.label.toUpperCase() === "YES")?.amount ?? 0;
  const noAmount = outcomeAmounts.find((outcome) => outcome.label.toUpperCase() === "NO")?.amount ?? 0;
  const totalAmount = outcomeAmounts.reduce((total, outcome) => total + outcome.amount, 0);

  return {
    yesAmount,
    noAmount,
    totalAmount,
    outcomeAmounts
  };
}

export function calculateResolutionPayouts(
  positions: PositionLike[],
  resolutionOutcomeId: string | null | undefined
) {
  const payouts = new Map<string, number>();
  const totalPot = positions.reduce((total, position) => total + position.amount, 0);

  if (!resolutionOutcomeId || totalPot === 0) {
    return payouts;
  }

  const winningPositions = positions.filter((position) => getPositionOutcomeId(position) === resolutionOutcomeId);
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

  const distributed = rawShares.reduce((total, share) => total + share.payout, 0);
  const remainderPool = Math.max(0, totalPot - distributed);

  rawShares
    .sort((left, right) => right.remainder - left.remainder)
    .forEach((share, index) => {
      const bonus = index < remainderPool ? 1 : 0;
      payouts.set(share.userId, (payouts.get(share.userId) ?? 0) + share.payout + bonus);
    });

  return payouts;
}

export function calculateNetResults(
  positions: PositionLike[],
  resolutionOutcomeId: string | null | undefined
) {
  const payouts = calculateResolutionPayouts(positions, resolutionOutcomeId);
  const netResults = new Map<string, number>();

  for (const position of positions) {
    netResults.set(position.userId, (netResults.get(position.userId) ?? 0) - position.amount);
  }

  for (const [userId, payout] of payouts.entries()) {
    netResults.set(userId, (netResults.get(userId) ?? 0) + payout);
  }

  return netResults;
}
