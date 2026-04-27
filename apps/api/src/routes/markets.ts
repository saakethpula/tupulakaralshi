import { GroupRole, MarketStatus, PositionSide, PositionStatus, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  calculateNetResults,
  calculateMarketSummary,
  calculateResolutionPayouts,
  calculateUserPosition,
  filterConfirmedPositions,
  filterPendingPositions
} from "../lib/market.js";
import { notifyGroupMembers } from "../lib/realtime.js";
import { asyncHandler } from "../middleware/async-handler.js";

export const marketsRouter = Router();

const PAYOUT_CONFIRMATION_STATUS = {
  PENDING_CREATOR: "PENDING_CREATOR",
  PENDING_RECIPIENT: "PENDING_RECIPIENT",
  DISPUTED: "DISPUTED",
  CONFIRMED: "CONFIRMED"
} as const;

type PayoutConfirmationStatus = (typeof PAYOUT_CONFIRMATION_STATUS)[keyof typeof PAYOUT_CONFIRMATION_STATUS];
const RESOLUTION_CONFIRMATION_PERCENTAGE = 0.3;

const createMarketSchema = z.object({
  groupId: z.string().min(1),
  targetUserId: z.string().min(1).nullable().optional(),
  question: z.string().min(10).max(200),
  description: z.string().max(1000).optional(),
  closesAt: z.string().datetime().refine((value) => new Date(value) > new Date(), {
    message: "closesAt must be in the future"
  }),
  resolvesAt: z.string().datetime().optional(),
  outcomes: z
    .array(z.string().trim().min(1).max(40))
    .min(2)
    .max(5)
    .optional()
    .transform((outcomes) => outcomes ?? ["YES", "NO"])
});

const createPositionSchema = z.object({
  outcomeId: z.string().min(1).optional(),
  side: z.nativeEnum(PositionSide).optional(),
  amount: z.coerce.number().int().min(0).max(100000)
});

const resolveMarketSchema = z.object({
  outcomeId: z.string().min(1).optional(),
  resolution: z.boolean().optional()
});

const recipientPayoutResponseSchema = z.object({
  received: z.boolean()
});

type PrismaClientOrTransaction = typeof prisma | Prisma.TransactionClient;
type ResolutionTransactionResult =
  | { market: SerializableMarket }
  | { error: { status: number; message: string } };

type SerializableMarket = {
  id: string;
  groupId: string;
  createdByUserId: string;
  targetUserId: string | null;
  question: string;
  description: string | null;
  closesAt: Date;
  resolvesAt: Date | null;
  status: MarketStatus;
  resolution: boolean | null;
  resolutionOutcomeId: string | null;
  resolutionProposedByUserId: string | null;
  resolutionProposedAt: Date | null;
  liquidityPool: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; displayName: string; venmoHandle?: string | null };
  resolutionProposedBy: { id: string; displayName: string } | null;
  group: {
    minBet: number;
    maxBet: number;
    memberships: Array<{
      userId: string;
    }>;
  };
  targetUser: { id: string; displayName: string } | null;
  positions: Array<{
    id: string;
    marketId: string;
    userId: string;
    side: PositionSide | null;
    outcomeId: string | null;
    status: PositionStatus;
    amount: number;
    createdAt: Date;
    confirmedAt: Date | null;
    user?: {
      id: string;
      displayName: string;
      venmoHandle: string | null;
    };
  }>;
  outcomes: Array<{
    id: string;
    label: string;
    sortOrder: number;
  }>;
  payoutConfirmations: Array<{
    id: string;
    recipientUserId: string;
    amount: number;
    status: PayoutConfirmationStatus;
    creatorMarkedAt: Date | null;
    recipientRespondedAt: Date | null;
    recipient: {
      id: string;
      displayName: string;
      venmoHandle: string | null;
    };
  }>;
  resolutionConfirmations: Array<{
    id: string;
    userId: string;
    createdAt: Date;
    user: {
      id: string;
      displayName: string;
    };
  }>;
};

const detailedMarketInclude = {
  createdBy: true,
  resolutionProposedBy: {
    select: {
      id: true,
      displayName: true
    }
  },
  targetUser: true,
  outcomes: {
    orderBy: {
      sortOrder: "asc"
    }
  },
  positions: {
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          venmoHandle: true
        }
      }
    }
  },
  payoutConfirmations: {
    include: {
      recipient: {
        select: {
          id: true,
          displayName: true,
          venmoHandle: true
        }
      }
    }
  },
  resolutionConfirmations: {
    include: {
      user: {
        select: {
          id: true,
          displayName: true,
          venmoHandle: true
        }
      }
    }
  },
  group: {
    select: {
      minBet: true,
      maxBet: true,
      memberships: {
        select: {
          userId: true
        }
      }
    }
  }
} as const;

async function findDetailedMarket(marketId: string) {
  return prisma.market.findUnique({
    where: { id: marketId },
    include: detailedMarketInclude
  } as never) as unknown as Promise<SerializableMarket | null>;
}

async function findDetailedMarketOrThrow(tx: PrismaClientOrTransaction, marketId: string) {
  return tx.market.findUniqueOrThrow({
    where: { id: marketId },
    include: detailedMarketInclude
  } as never) as unknown as Promise<SerializableMarket>;
}

async function lockMarketPayoutConfirmations(tx: PrismaClientOrTransaction, marketId: string) {
  await tx.$queryRaw`
    SELECT id
    FROM "MarketPayoutConfirmation"
    WHERE "marketId" = ${marketId}
    FOR UPDATE
  `;
}

async function refreshPayoutFinalization(tx: PrismaClientOrTransaction, marketId: string) {
  const pendingCount = await tx.marketPayoutConfirmation.count({
    where: {
      marketId,
      status: {
        not: PAYOUT_CONFIRMATION_STATUS.CONFIRMED
      }
    }
  });

  await tx.market.update({
    where: { id: marketId },
    data: {
      payoutsFinalizedAt: pendingCount === 0 ? new Date() : null
    } as never
  } as never);
}

function calculateRequiredResolutionConfirmations(groupMemberCount: number) {
  return Math.max(1, Math.ceil(groupMemberCount * RESOLUTION_CONFIRMATION_PERCENTAGE));
}

async function finalizeMarketResolution(
  tx: PrismaClientOrTransaction,
  market: Pick<SerializableMarket, "id" | "positions" | "resolvesAt">,
  resolutionOutcomeId: string
) {
  const confirmedPositions = filterConfirmedPositions(market.positions);
  const payouts = calculateResolutionPayouts(confirmedPositions, resolutionOutcomeId);
  const netResults = calculateNetResults(confirmedPositions, resolutionOutcomeId);

  await Promise.all([...netResults.entries()].flatMap(([userId, netResult]) => {
    if (netResult === 0) {
      return [];
    }

    return tx.user.update({
      where: { id: userId },
      data: {
        balance: {
          increment: netResult
        }
      }
    });
  }));

  await tx.market.update({
    where: { id: market.id },
    data: {
      status: MarketStatus.RESOLVED,
      resolutionOutcomeId,
      resolvesAt: market.resolvesAt ?? new Date(),
      payoutsFinalizedAt: payouts.size === 0 ? new Date() : null
    } as never
  } as never);

  await (tx as any).marketPayoutConfirmation.deleteMany({
    where: { marketId: market.id }
  });

  if (payouts.size > 0) {
    await (tx as any).marketPayoutConfirmation.createMany({
      data: [...payouts.entries()].map(([recipientUserId, amount]) => ({
        marketId: market.id,
        recipientUserId,
        amount,
        status: PAYOUT_CONFIRMATION_STATUS.PENDING_CREATOR
      }))
    });
  }
}

function serializeMarket(market: SerializableMarket, currentUserId: string) {
  const { group, ...marketWithoutGroup } = market;
  const confirmedPositions = filterConfirmedPositions(market.positions);
  const pendingPositions = filterPendingPositions(market.positions);
  const payouts = calculateResolutionPayouts(confirmedPositions, market.resolutionOutcomeId);
  const creatorPayouts = [...payouts.entries()]
    .map(([userId, amount]) => {
      const user = market.positions.find((position) => position.userId === userId)?.user;
      return {
        userId,
        displayName: user?.displayName ?? "Family member",
        amount
      };
    })
    .sort((left, right) => right.amount - left.amount);
  const creatorCollections = [...new Map(
    confirmedPositions
      .filter((position) => position.userId !== market.createdByUserId)
      .map((position) => [position.userId, {
        userId: position.userId,
        displayName: position.user?.displayName ?? "Family member",
        venmoHandle: position.user?.venmoHandle ?? null,
        amount: 0
      }])
  ).values()]
    .map((entry) => ({
      ...entry,
      amount: confirmedPositions
        .filter((position) => position.userId === entry.userId)
        .reduce((total, position) => total + position.amount, 0)
    }))
    .filter((entry) => entry.amount > 0)
    .sort((left, right) => right.amount - left.amount);
  const pendingConfirmations = pendingPositions
    .map((position) => ({
      positionId: position.id,
      userId: position.userId,
      displayName: position.user?.displayName ?? "Family member",
      outcomeId: position.outcomeId,
      outcomeLabel: market.outcomes.find((outcome) => outcome.id === position.outcomeId)?.label ?? position.side ?? "Outcome",
      amount: position.amount,
      createdAt: position.createdAt
    }))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const payoutConfirmations = market.payoutConfirmations
    .map((confirmation) => ({
      id: confirmation.id,
      recipientUserId: confirmation.recipientUserId,
      displayName: confirmation.recipient.displayName,
      venmoHandle: confirmation.recipient.venmoHandle,
      amount: confirmation.amount,
      status: confirmation.status,
      creatorMarkedAt: confirmation.creatorMarkedAt,
      recipientRespondedAt: confirmation.recipientRespondedAt
    }))
    .sort((left, right) => right.amount - left.amount);
  const creatorPayoutsPendingCount = payoutConfirmations.filter(
    (confirmation) => confirmation.status !== "CONFIRMED"
  ).length;
  const userPayoutConfirmation =
    payoutConfirmations.find((confirmation) => confirmation.recipientUserId === currentUserId) ?? null;
  const resolutionConfirmations = market.resolutionConfirmations
    .map((confirmation) => ({
      id: confirmation.id,
      userId: confirmation.userId,
      displayName: confirmation.user.displayName,
      createdAt: confirmation.createdAt
    }))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const userResolutionConfirmation =
    resolutionConfirmations.find((confirmation) => confirmation.userId === currentUserId) ?? null;
  const requiredResolutionConfirmations = calculateRequiredResolutionConfirmations(group.memberships.length);

  return {
    ...marketWithoutGroup,
    isGeneral: market.targetUserId === null,
    summary: calculateMarketSummary(confirmedPositions, market.outcomes),
    userPosition: calculateUserPosition(confirmedPositions, currentUserId, market.outcomes),
    userPendingPosition: calculateUserPosition(pendingPositions, currentUserId, market.outcomes),
    userPayout: payouts.get(currentUserId) ?? 0,
    venmoRecipient: {
      userId: market.createdBy.id,
      displayName: market.createdBy.displayName,
      venmoHandle: market.createdBy.venmoHandle ?? null
    },
    creatorPayouts,
    creatorCollections,
    payoutConfirmations,
    creatorPayoutsPendingCount,
    userPayoutConfirmation,
    resolutionConfirmations,
    resolutionConfirmationCount: resolutionConfirmations.length,
    requiredResolutionConfirmations,
    userResolutionConfirmation,
    pendingConfirmations
  };
}

marketsRouter.get("/", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const groupId = z.string().parse(req.query.groupId);

  const membership = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: {
        userId: currentUser.id,
        groupId
      }
    }
  });

  if (!membership) {
    return res.status(403).json({ message: "You are not part of this family group." });
  }

  const markets = await prisma.market.findMany({
    where: {
      groupId,
      OR: [
        { targetUserId: { equals: null } },
        {
          targetUserId: {
            not: currentUser.id
          }
        }
      ],
      NOT: {
        AND: [
          { status: MarketStatus.RESOLVED },
          { payoutsFinalizedAt: { not: null } }
        ]
      }
    },
    include: detailedMarketInclude,
    orderBy: {
      createdAt: "desc"
    }
  } as never) as unknown as SerializableMarket[];

  res.json(
    markets.map((market) => serializeMarket(market, currentUser.id))
  );
}));

marketsRouter.post("/", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const input = createMarketSchema.parse(req.body);
  const targetUserId = input.targetUserId ?? null;

  if (targetUserId && currentUser.id === targetUserId) {
    return res
      .status(400)
      .json({ message: "You cannot create a hidden market about yourself." });
  }

  const membership = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: {
        userId: currentUser.id,
        groupId: input.groupId
      }
    },
    include: {
      group: {
        include: {
          memberships: true
        }
      }
    }
  });

  if (!membership) {
    return res.status(403).json({ message: "You are not part of this family group." });
  }

  const targetMembership = membership.group.memberships.find(
    (groupMembership) => groupMembership.userId === targetUserId
  );

  if (targetUserId && !targetMembership) {
    return res.status(400).json({ message: "Target user is not in this family group." });
  }

  const normalizedOutcomes = [...new Set(input.outcomes.map((outcome) => outcome.trim()).filter(Boolean))];

  if (normalizedOutcomes.length < 2 || normalizedOutcomes.length > 5) {
    return res.status(400).json({ message: "Markets need between 2 and 5 unique outcomes." });
  }

  const market = await prisma.market.create({
    data: {
      groupId: input.groupId,
      createdByUserId: currentUser.id,
      targetUserId,
      question: input.question,
      description: input.description,
      closesAt: new Date(input.closesAt),
      resolvesAt: input.resolvesAt ? new Date(input.resolvesAt) : null,
      outcomes: {
        create: normalizedOutcomes.map((label, sortOrder) => ({
          label,
          sortOrder
        }))
      }
    },
    include: detailedMarketInclude
  } as never) as unknown as SerializableMarket;

  void notifyGroupMembers(market.groupId, "market.created");
  res.status(201).json({
    ...serializeMarket(market, currentUser.id)
  });
}));

marketsRouter.put("/:marketId/position", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const input = createPositionSchema.parse(req.body);

  const market = await findDetailedMarket(marketId);

  if (!market) {
    return res.status(404).json({ message: "Market not found." });
  }

  const membership = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: {
        userId: currentUser.id,
        groupId: market.groupId
      }
    }
  });

  if (!membership) {
    return res.status(403).json({ message: "You are not part of this family group." });
  }

  if (market.targetUserId === currentUser.id) {
    return res.status(403).json({
      message: "The family member this market is about cannot see or trade in it."
    });
  }

  if (market.status !== MarketStatus.OPEN || market.closesAt <= new Date()) {
    return res.status(400).json({ message: "This market is not open for trading." });
  }

  const requestedOutcomeId =
    input.outcomeId ??
    market.outcomes.find((outcome) => outcome.label.toUpperCase() === input.side)?.id;
  const requestedOutcome = market.outcomes.find((outcome) => outcome.id === requestedOutcomeId);

  if (!requestedOutcome) {
    return res.status(400).json({ message: "Choose a valid outcome for this market." });
  }

  const existingPositions = market.positions.filter((position) => position.userId === currentUser.id);
  const confirmedPositions = filterConfirmedPositions(existingPositions);
  const pendingPositions = filterPendingPositions(existingPositions);
  const confirmedTotalAmount = confirmedPositions.reduce((total, position) => total + position.amount, 0);
  const pendingTotalAmount = pendingPositions.reduce((total, position) => total + position.amount, 0);
  const liveOrPendingTotalAmount = confirmedTotalAmount + pendingTotalAmount;
  const existingOutcomeId = existingPositions[0]?.outcomeId ?? null;

  if (liveOrPendingTotalAmount > 0 && input.amount < liveOrPendingTotalAmount) {
    return res.status(400).json({
      message: "You can only increase your position after it has been placed."
    });
  }

  if (existingOutcomeId && input.amount > 0 && requestedOutcome.id !== existingOutcomeId) {
    return res.status(400).json({
      message: "Your outcome is locked after your first bet. You can only add more to the same outcome."
    });
  }

  const amountToAdd = input.amount - liveOrPendingTotalAmount;

  if (amountToAdd === 0) {
    return res.status(400).json({ message: "Enter a larger amount to add to this position." });
  }

  if (input.amount > market.group.maxBet) {
    return res.status(400).json({
      message: `Your bet is too high. The maximum per market is ${market.group.maxBet}.`
    });
  }

  if (amountToAdd < market.group.minBet) {
    return res.status(400).json({
      message: `Your bet is too low. The minimum bet is ${market.group.minBet}.`
    });
  }

  const updatedMarket = await prisma.$transaction(async (tx) => {
    if (amountToAdd > 0) {
      await tx.position.create({
        data: {
          marketId,
          userId: currentUser.id,
          side: requestedOutcome.label.toUpperCase() === "YES" ? PositionSide.YES : requestedOutcome.label.toUpperCase() === "NO" ? PositionSide.NO : null,
          outcomeId: requestedOutcome.id,
          status: PositionStatus.CONFIRMED,
          confirmedAt: new Date(),
          amount: amountToAdd
        }
      });
    }
    
    return findDetailedMarketOrThrow(tx, marketId);
  });

  void notifyGroupMembers(updatedMarket.groupId, "market.position.updated");
  res.status(200).json(serializeMarket(updatedMarket, currentUser.id));
}));

marketsRouter.post("/:marketId/positions/:positionId/confirm", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const positionId = z.string().parse(req.params.positionId);

  const market = await findDetailedMarket(marketId);

  if (!market) {
    return res.status(404).json({ message: "Market not found." });
  }

  if (market.createdByUserId !== currentUser.id) {
    return res.status(403).json({ message: "Only the market creator can confirm payments." });
  }

  const membership = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: {
        userId: currentUser.id,
        groupId: market.groupId
      }
    }
  });

  if (!membership) {
    return res.status(403).json({ message: "You are not part of this family group." });
  }

  const position = market.positions.find((entry) => entry.id === positionId);

  if (!position || position.status !== PositionStatus.PENDING) {
    return res.status(404).json({ message: "Pending position not found." });
  }

  const updatedMarket = await prisma.$transaction(async (tx) => {
    await tx.position.update({
      where: { id: positionId },
      data: {
        status: PositionStatus.CONFIRMED,
        confirmedAt: new Date()
      }
    });

    return findDetailedMarketOrThrow(tx, marketId);
  });

  void notifyGroupMembers(updatedMarket.groupId, "market.position.confirmed");
  res.json(serializeMarket(updatedMarket, currentUser.id));
}));

marketsRouter.delete("/:marketId/positions/:positionId", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const positionId = z.string().parse(req.params.positionId);

  const market = await findDetailedMarket(marketId);

  if (!market) {
    return res.status(404).json({ message: "Market not found." });
  }

  if (market.createdByUserId !== currentUser.id) {
    return res.status(403).json({ message: "Only the market creator can reject pending payments." });
  }

  const position = market.positions.find((entry) => entry.id === positionId);

  if (!position || position.status !== PositionStatus.PENDING) {
    return res.status(404).json({ message: "Pending position not found." });
  }

  const updatedMarket = await prisma.$transaction(async (tx) => {
    await tx.position.delete({
      where: { id: positionId }
    });

    return findDetailedMarketOrThrow(tx, marketId);
  });

  void notifyGroupMembers(updatedMarket.groupId, "market.position.rejected");
  res.json(serializeMarket(updatedMarket, currentUser.id));
}));

marketsRouter.post("/:marketId/resolve", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const input = resolveMarketSchema.parse(req.body);

  const market = await findDetailedMarket(marketId);

  if (!market) {
    return res.status(404).json({ message: "Market not found." });
  }

  const membership = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: {
        userId: currentUser.id,
        groupId: market.groupId
      }
    }
  });

  if (!membership || membership.role !== GroupRole.ADMIN) {
    return res.status(403).json({ message: "Only family admins can resolve markets." });
  }

  if (market.targetUserId === currentUser.id) {
    return res.status(403).json({
      message: "The family member this market is about cannot resolve it."
    });
  }

  if (market.status === MarketStatus.RESOLVED) {
    return res.status(400).json({ message: "This market has already been resolved." });
  }

  if (market.status === MarketStatus.PENDING_RESOLUTION) {
    return res.status(400).json({ message: "This market is already waiting for resolution confirmations." });
  }

  if (!input.outcomeId && input.resolution === undefined) {
    return res.status(400).json({ message: "Choose an outcome to resolve this market." });
  }

  const resolutionOutcomeId =
    input.outcomeId ??
    market.outcomes.find((outcome) => outcome.label.toUpperCase() === (input.resolution ? "YES" : "NO"))?.id;
  const resolutionOutcome = market.outcomes.find((outcome) => outcome.id === resolutionOutcomeId);

  if (!resolutionOutcome) {
    return res.status(400).json({ message: "Choose a valid outcome to resolve this market." });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.market.update({
      where: { id: marketId },
      data: {
        status: MarketStatus.PENDING_RESOLUTION,
        resolution: resolutionOutcome.label.toUpperCase() === "YES" ? true : resolutionOutcome.label.toUpperCase() === "NO" ? false : null,
        resolutionOutcomeId: resolutionOutcome.id,
        resolutionProposedByUserId: currentUser.id,
        resolutionProposedAt: new Date(),
        payoutsFinalizedAt: null
      } as never
    } as never);

    await (tx as any).marketResolutionConfirmation.deleteMany({
      where: { marketId }
    });

    return findDetailedMarketOrThrow(tx, marketId);
  });

  void notifyGroupMembers(updated.groupId, "market.resolution.proposed");
  res.json(serializeMarket(updated, currentUser.id));
}));

marketsRouter.post("/:marketId/resolution/confirm", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const market = await findDetailedMarket(marketId);

  if (!market) {
    return res.status(404).json({ message: "Market not found." });
  }

  const membership = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: {
        userId: currentUser.id,
        groupId: market.groupId
      }
    }
  });

  if (!membership) {
    return res.status(403).json({ message: "You are not part of this family group." });
  }

  if (market.targetUserId === currentUser.id) {
    return res.status(403).json({
      message: "The family member this market is about cannot confirm its resolution."
    });
  }

  if (market.status !== MarketStatus.PENDING_RESOLUTION || !market.resolutionOutcomeId) {
    return res.status(400).json({ message: "This market is not waiting for resolution confirmations." });
  }

  if (market.resolutionProposedByUserId === currentUser.id) {
    return res.status(403).json({ message: "The admin who proposed the resolution cannot confirm it." });
  }

  if (market.resolutionConfirmations.some((confirmation) => confirmation.userId === currentUser.id)) {
    return res.status(400).json({ message: "You have already confirmed this resolution." });
  }

  const resolutionResult = await prisma.$transaction(async (tx): Promise<ResolutionTransactionResult> => {
    const transactionalMarket = await findDetailedMarketOrThrow(tx, marketId);

    if (transactionalMarket.status !== MarketStatus.PENDING_RESOLUTION || !transactionalMarket.resolutionOutcomeId) {
      return {
        error: {
          status: 400,
          message: "This market is not waiting for resolution confirmations."
        }
      };
    }

    if (transactionalMarket.resolutionProposedByUserId === currentUser.id) {
      return {
        error: {
          status: 403,
          message: "The admin who proposed the resolution cannot confirm it."
        }
      };
    }

    await (tx as any).marketResolutionConfirmation.createMany({
      data: {
        marketId,
        userId: currentUser.id
      },
      skipDuplicates: true
    });

    const confirmationCount = await (tx as any).marketResolutionConfirmation.count({
      where: { marketId }
    });

    const requiredResolutionConfirmations = calculateRequiredResolutionConfirmations(transactionalMarket.group.memberships.length);

    if (confirmationCount >= requiredResolutionConfirmations) {
      await finalizeMarketResolution(tx, transactionalMarket, transactionalMarket.resolutionOutcomeId);
    }

    return {
      market: await findDetailedMarketOrThrow(tx, marketId)
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });

  const resolutionError = "error" in resolutionResult ? resolutionResult.error : null;

  if (resolutionError) {
    return res.status(resolutionError.status).json({ message: resolutionError.message });
  }

  if (!("market" in resolutionResult)) {
    return res.status(500).json({ message: "Resolution confirmation failed." });
  }

  const updatedMarket = resolutionResult.market;

  void notifyGroupMembers(updatedMarket.groupId, updatedMarket.status === MarketStatus.RESOLVED ? "market.resolved" : "market.resolution.confirmed");
  res.json(serializeMarket(updatedMarket, currentUser.id));
}));

marketsRouter.delete("/:marketId", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: {
      positions: true
    }
  });

  if (!market) {
    return res.status(404).json({ message: "Market not found." });
  }

  const membership = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: {
        userId: currentUser.id,
        groupId: market.groupId
      }
    }
  });

  if (!membership) {
    return res.status(403).json({ message: "You are not part of this family group." });
  }

  if (market.createdByUserId !== currentUser.id && membership.role !== GroupRole.ADMIN) {
    return res.status(403).json({ message: "Only the market creator or a group admin can remove this market." });
  }

  if (market.status === MarketStatus.RESOLVED) {
    return res.status(400).json({ message: "Resolved markets cannot be removed." });
  }

  await prisma.$transaction(async (tx) => {
    await tx.market.delete({
      where: { id: marketId }
    });
  });

  void notifyGroupMembers(market.groupId, "market.deleted");
  res.json({ deleted: true });
}));

marketsRouter.post("/:marketId/payouts/:payoutId/sent", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const payoutId = z.string().parse(req.params.payoutId);

  const market = await findDetailedMarket(marketId);

  if (!market) {
    return res.status(404).json({ message: "Market not found." });
  }

  if (market.createdByUserId !== currentUser.id) {
    return res.status(403).json({ message: "Only the market creator can mark payouts as sent." });
  }

  const membership = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: {
        userId: currentUser.id,
        groupId: market.groupId
      }
    }
  });

  if (!membership) {
    return res.status(403).json({ message: "You are not part of this family group." });
  }

  if (market.status !== MarketStatus.RESOLVED) {
    return res.status(400).json({ message: "Only resolved markets can start payout confirmations." });
  }

  const payout = market.payoutConfirmations.find((entry) => entry.id === payoutId);

  if (!payout) {
    return res.status(404).json({ message: "Payout confirmation not found." });
  }

  const updatedMarket = await prisma.$transaction(async (tx) => {
    await lockMarketPayoutConfirmations(tx, marketId);

    await (tx as any).marketPayoutConfirmation.update({
      where: { id: payoutId },
      data: {
        status: PAYOUT_CONFIRMATION_STATUS.PENDING_RECIPIENT,
        creatorMarkedAt: new Date()
      }
    });

    await refreshPayoutFinalization(tx, marketId);

    return findDetailedMarketOrThrow(tx, marketId);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });

  void notifyGroupMembers(updatedMarket.groupId, "market.payout.sent");
  res.json(serializeMarket(updatedMarket, currentUser.id));
}));

marketsRouter.post("/:marketId/payouts/:payoutId/respond", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const payoutId = z.string().parse(req.params.payoutId);
  const input = recipientPayoutResponseSchema.parse(req.body);

  const market = await findDetailedMarket(marketId);

  if (!market) {
    return res.status(404).json({ message: "Market not found." });
  }

  const payout = market.payoutConfirmations.find((entry) => entry.id === payoutId);

  if (!payout || payout.recipientUserId !== currentUser.id) {
    return res.status(404).json({ message: "Payout confirmation not found for this user." });
  }

  if (payout.status !== PAYOUT_CONFIRMATION_STATUS.PENDING_RECIPIENT && payout.status !== PAYOUT_CONFIRMATION_STATUS.DISPUTED) {
    return res.status(400).json({ message: "This payout is not waiting on your confirmation yet." });
  }

  const updatedMarket = await prisma.$transaction(async (tx) => {
    await lockMarketPayoutConfirmations(tx, marketId);

    await (tx as any).marketPayoutConfirmation.update({
      where: { id: payoutId },
      data: {
        status: input.received ? PAYOUT_CONFIRMATION_STATUS.CONFIRMED : PAYOUT_CONFIRMATION_STATUS.DISPUTED,
        recipientRespondedAt: new Date()
      }
    });

    await refreshPayoutFinalization(tx, marketId);

    return findDetailedMarketOrThrow(tx, marketId);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });

  void notifyGroupMembers(updatedMarket.groupId, "market.payout.responded");
  res.json(serializeMarket(updatedMarket, currentUser.id));
}));
