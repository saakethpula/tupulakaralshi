import { GroupRole, MarketStatus, PositionSide, PositionStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import {
  calculateMarketSummary,
  calculateResolutionPayouts,
  calculateUserPosition,
  filterConfirmedPositions,
  filterPendingPositions
} from "../lib/market.js";
import { asyncHandler } from "../middleware/async-handler.js";

export const marketsRouter = Router();

const createMarketSchema = z.object({
  groupId: z.string().min(1),
  targetUserId: z.string().min(1),
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

type SerializableMarket = {
  id: string;
  groupId: string;
  createdByUserId: string;
  targetUserId: string;
  question: string;
  description: string | null;
  closesAt: Date;
  resolvesAt: Date | null;
  status: MarketStatus;
  resolution: boolean | null;
  liquidityPool: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { id: string; displayName: string };
  targetUser: { id: string; displayName: string };
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
};

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

  return {
    ...market,
    summary: calculateMarketSummary(market, confirmedPositions),
    userPosition: calculateUserPosition(confirmedPositions, currentUserId),
    userPendingPosition: calculateUserPosition(pendingPositions, currentUserId),
    userPayout: payouts.get(currentUserId) ?? 0,
    venmoRecipient: {
      userId: market.createdBy.id,
      displayName: market.createdBy.displayName
    },
    creatorPayouts,
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
      targetUserId: {
        not: currentUser.id
      }
    },
    include: {
      createdBy: true,
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
      }
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  res.json(
    markets.map((market) => serializeMarket(market, currentUser.id))
  );
}));

marketsRouter.post("/", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const input = createMarketSchema.parse(req.body);

  if (currentUser.id === input.targetUserId) {
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
    (groupMembership) => groupMembership.userId === input.targetUserId
  );

  if (!targetMembership) {
    return res.status(400).json({ message: "Target user is not in this family group." });
  }

  const market = await prisma.market.create({
    data: {
      groupId: input.groupId,
      createdByUserId: currentUser.id,
      targetUserId: input.targetUserId,
      question: input.question,
      description: input.description,
      closesAt: new Date(input.closesAt),
      resolvesAt: input.resolvesAt ? new Date(input.resolvesAt) : null
    },
    include: {
      createdBy: true,
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
      }
    }
  });

  res.status(201).json({
    ...serializeMarket(market, currentUser.id)
  });
}));

marketsRouter.put("/:marketId/position", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const input = createPositionSchema.parse(req.body);

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: {
      createdBy: true,
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
      }
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

  if (market.targetUserId === currentUser.id) {
    return res.status(403).json({
      message: "The family member this market is about cannot see or trade in it."
    });
  }

  if (market.status !== MarketStatus.OPEN || market.closesAt <= new Date()) {
    return res.status(400).json({ message: "This market is not open for trading." });
  }

  const currentPositionAmount = market.positions
    .filter((position) => position.userId === currentUser.id)
    .reduce((total, position) => total + position.amount, 0);
  const spendableBalance = currentUser.balance + currentPositionAmount;

  if (input.amount > spendableBalance) {
    return res.status(400).json({
      message: "You do not have enough balance for that position."
    });
  }

  const updatedMarket = await prisma.$transaction(async (tx) => {
    await tx.position.deleteMany({
      where: {
        marketId,
        userId: currentUser.id
      }
    });

    await tx.user.update({
      where: { id: currentUser.id },
      data: {
        balance: spendableBalance - input.amount
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
    
    return tx.market.findUniqueOrThrow({
      where: { id: marketId },
      include: {
        createdBy: true,
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
        }
      }
    });
  });

  res.status(200).json(serializeMarket(updatedMarket, currentUser.id));
}));

marketsRouter.post("/:marketId/positions/:positionId/confirm", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const positionId = z.string().parse(req.params.positionId);

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: {
      createdBy: true,
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
      }
    }
  });

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

    return tx.market.findUniqueOrThrow({
      where: { id: marketId },
      include: {
        createdBy: true,
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
        }
      }
    });
  });

  res.json(serializeMarket(updatedMarket, currentUser.id));
}));

marketsRouter.delete("/:marketId/positions/:positionId", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const positionId = z.string().parse(req.params.positionId);

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: {
      createdBy: true,
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
      }
    }
  });

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
    await tx.user.update({
      where: { id: position.userId },
      data: {
        balance: {
          increment: position.amount
        }
      }
    });

    await tx.position.delete({
      where: { id: positionId }
    });

    return tx.market.findUniqueOrThrow({
      where: { id: marketId },
      include: {
        createdBy: true,
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
        }
      }
    });
  });

  res.json(serializeMarket(updatedMarket, currentUser.id));
}));

marketsRouter.post("/:marketId/resolve", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const input = resolveMarketSchema.parse(req.body);

  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: {
      positions: true,
      createdBy: true,
      targetUser: true
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

  const confirmedPositions = filterConfirmedPositions(market.positions);
  const payouts = calculateResolutionPayouts(confirmedPositions, input.resolution);
  const updated = await prisma.$transaction(async (tx) => {
    for (const [userId, payout] of payouts.entries()) {
      await tx.user.update({
        where: { id: userId },
        data: {
          balance: {
            increment: payout
          }
        }
      });
    }

    await tx.market.update({
      where: { id: marketId },
      data: {
        status: MarketStatus.RESOLVED,
        resolution: input.resolution,
        resolvesAt: market.resolvesAt ?? new Date()
      }
    });

    return tx.market.findUniqueOrThrow({
      where: { id: marketId },
      include: {
        createdBy: true,
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
        }
      }
    });
  });

  res.json(serializeMarket(updated, currentUser.id));
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

  const refunds = new Map<string, number>();

  for (const position of market.positions) {
    refunds.set(position.userId, (refunds.get(position.userId) ?? 0) + position.amount);
  }

  await prisma.$transaction(async (tx) => {
    for (const [userId, amount] of refunds.entries()) {
      await tx.user.update({
        where: { id: userId },
        data: {
          balance: {
            increment: amount
          }
        }
      });
    }

    await tx.market.delete({
      where: { id: marketId }
    });
  });

  res.json({ deleted: true });
}));
