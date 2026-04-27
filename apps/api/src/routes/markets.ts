import { GroupRole, MarketStatus, PositionSide, PositionStatus } from "@prisma/client";
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
const REQUIRED_RESOLUTION_CONFIRMATIONS = 3;

const createMarketSchema = z.object({
  groupId: z.string().min(1),
  targetUserId: z.string().min(1).nullable().optional(),
  question: z.string().min(10).max(200),
  description: z.string().max(1000).optional(),
  closesAt: z.string().datetime(),
  resolvesAt: z.string().datetime().optional()
});

const createPositionSchema = z.object({
  side: z.nativeEnum(PositionSide),
  amount: z.coerce.number().int().min(0).max(100000)
});

const resolveMarketSchema = z.object({
  resolution: z.boolean()
});

const recipientPayoutResponseSchema = z.object({
  received: z.boolean()
});

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
  resolutionProposedByUserId: string | null;
  resolutionProposedAt: Date | null;
  liquidityPool: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; displayName: string; venmoHandle?: string | null };
  resolutionProposedBy: { id: string; displayName: string } | null;
  targetUser: { id: string; displayName: string } | null;
  positions: Array<{
    id: string;
    marketId: string;
    userId: string;
    side: PositionSide;
    status: PositionStatus;
    amount: number;
    createdAt: Date;
    confirmedAt: Date | null;
    user?: {
      id: string;
      displayName: string;
    };
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
  positions: {
    include: {
      user: {
        select: {
          id: true,
          displayName: true
        }
      }
    }
  },
  payoutConfirmations: {
    include: {
      recipient: {
        select: {
          id: true,
          displayName: true
        }
      }
    }
  },
  resolutionConfirmations: {
    include: {
      user: {
        select: {
          id: true,
          displayName: true
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

async function findDetailedMarketOrThrow(tx: typeof prisma | Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">, marketId: string) {
  return tx.market.findUniqueOrThrow({
    where: { id: marketId },
    include: detailedMarketInclude
  } as never) as unknown as Promise<SerializableMarket>;
}

async function refreshPayoutFinalization(tx: typeof prisma | Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">, marketId: string) {
  const payoutConfirmations = await (tx as any).marketPayoutConfirmation.findMany({
    where: { marketId }
  });

  const allConfirmed =
    payoutConfirmations.length === 0 ||
    payoutConfirmations.every((confirmation: { status: PayoutConfirmationStatus }) => confirmation.status === PAYOUT_CONFIRMATION_STATUS.CONFIRMED);

  await tx.market.update({
    where: { id: marketId },
    data: {
      payoutsFinalizedAt: allConfirmed ? new Date() : null
    } as never
  } as never);
}

async function finalizeMarketResolution(
  tx: typeof prisma | Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">,
  market: Pick<SerializableMarket, "id" | "positions" | "resolvesAt">,
  resolution: boolean
) {
  const confirmedPositions = filterConfirmedPositions(market.positions);
  const payouts = calculateResolutionPayouts(confirmedPositions, resolution);
  const netResults = calculateNetResults(confirmedPositions, resolution);

  for (const [userId, netResult] of netResults.entries()) {
    if (netResult === 0) {
      continue;
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        balance: {
          increment: netResult
        }
      }
    });
  }

  await tx.market.update({
    where: { id: market.id },
    data: {
      status: MarketStatus.RESOLVED,
      resolution,
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
  const confirmedPositions = filterConfirmedPositions(market.positions);
  const pendingPositions = filterPendingPositions(market.positions);
  const payouts = calculateResolutionPayouts(confirmedPositions, market.resolution);
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
  const pendingConfirmations = pendingPositions
    .map((position) => ({
      positionId: position.id,
      userId: position.userId,
      displayName: position.user?.displayName ?? "Family member",
      side: position.side,
      amount: position.amount,
      createdAt: position.createdAt
    }))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const payoutConfirmations = market.payoutConfirmations
    .map((confirmation) => ({
      id: confirmation.id,
      recipientUserId: confirmation.recipientUserId,
      displayName: confirmation.recipient.displayName,
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

  return {
    ...market,
    isGeneral: market.targetUserId === null,
    summary: calculateMarketSummary(confirmedPositions),
    userPosition: calculateUserPosition(confirmedPositions, currentUserId),
    userPendingPosition: calculateUserPosition(pendingPositions, currentUserId),
    userPayout: payouts.get(currentUserId) ?? 0,
    venmoRecipient: {
      userId: market.createdBy.id,
      displayName: market.createdBy.displayName,
      venmoHandle: market.createdBy.venmoHandle ?? null
    },
    creatorPayouts,
    payoutConfirmations,
    creatorPayoutsPendingCount,
    userPayoutConfirmation,
    resolutionConfirmations,
    resolutionConfirmationCount: resolutionConfirmations.length,
    requiredResolutionConfirmations: REQUIRED_RESOLUTION_CONFIRMATIONS,
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

  const market = await prisma.market.create({
    data: {
      groupId: input.groupId,
      createdByUserId: currentUser.id,
      targetUserId,
      question: input.question,
      description: input.description,
      closesAt: new Date(input.closesAt),
      resolvesAt: input.resolvesAt ? new Date(input.resolvesAt) : null
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

  const existingPositions = market.positions.filter((position) => position.userId === currentUser.id);
  const existingTotalAmount = existingPositions.reduce((total, position) => total + position.amount, 0);
  const existingSide = existingPositions[0]?.side ?? null;

  if (existingTotalAmount > 0 && input.amount < existingTotalAmount) {
    return res.status(400).json({
      message: "You can only increase your position after it has been placed."
    });
  }

  if (existingSide && input.amount > 0 && input.side !== existingSide) {
    return res.status(400).json({
      message: "Your side is locked after your first bet. You can only add more to the same side."
    });
  }

  const updatedMarket = await prisma.$transaction(async (tx) => {
    await tx.position.deleteMany({
      where: {
        marketId,
        userId: currentUser.id
      }
    });

    if (input.amount > 0) {
      await tx.position.create({
        data: {
          marketId,
          userId: currentUser.id,
          side: input.side,
          status: PositionStatus.PENDING,
          amount: input.amount
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

  const updated = await prisma.$transaction(async (tx) => {
    await tx.market.update({
      where: { id: marketId },
      data: {
        status: MarketStatus.PENDING_RESOLUTION,
        resolution: input.resolution,
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

  if (market.status !== MarketStatus.PENDING_RESOLUTION || market.resolution === null) {
    return res.status(400).json({ message: "This market is not waiting for resolution confirmations." });
  }

  if (market.resolutionProposedByUserId === currentUser.id) {
    return res.status(403).json({ message: "The admin who proposed the resolution cannot confirm it." });
  }

  if (market.resolutionConfirmations.some((confirmation) => confirmation.userId === currentUser.id)) {
    return res.status(400).json({ message: "You have already confirmed this resolution." });
  }

  const proposedResolution = market.resolution;

  const updatedMarket = await prisma.$transaction(async (tx) => {
    await (tx as any).marketResolutionConfirmation.create({
      data: {
        marketId,
        userId: currentUser.id
      }
    });

    const confirmationCount = await (tx as any).marketResolutionConfirmation.count({
      where: { marketId }
    });

    if (confirmationCount >= REQUIRED_RESOLUTION_CONFIRMATIONS) {
      await finalizeMarketResolution(tx, market, proposedResolution);
    }

    return findDetailedMarketOrThrow(tx, marketId);
  });

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

  if (market.status !== MarketStatus.RESOLVED) {
    return res.status(400).json({ message: "Only resolved markets can start payout confirmations." });
  }

  const payout = market.payoutConfirmations.find((entry) => entry.id === payoutId);

  if (!payout) {
    return res.status(404).json({ message: "Payout confirmation not found." });
  }

  const updatedMarket = await prisma.$transaction(async (tx) => {
    await (tx as any).marketPayoutConfirmation.update({
      where: { id: payoutId },
      data: {
        status: PAYOUT_CONFIRMATION_STATUS.PENDING_RECIPIENT,
        creatorMarkedAt: new Date()
      }
    });

    await refreshPayoutFinalization(tx, marketId);

    return findDetailedMarketOrThrow(tx, marketId);
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
    await (tx as any).marketPayoutConfirmation.update({
      where: { id: payoutId },
      data: {
        status: input.received ? PAYOUT_CONFIRMATION_STATUS.CONFIRMED : PAYOUT_CONFIRMATION_STATUS.DISPUTED,
        recipientRespondedAt: new Date()
      }
    });

    await refreshPayoutFinalization(tx, marketId);

    return findDetailedMarketOrThrow(tx, marketId);
  });

  void notifyGroupMembers(updatedMarket.groupId, "market.payout.responded");
  res.json(serializeMarket(updatedMarket, currentUser.id));
}));
