import { GroupRole, MarketStatus, PositionSide } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { calculateMarketSummary } from "../lib/market.js";
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
  amount: z.coerce.number().int().min(1).max(1000)
});

const resolveMarketSchema = z.object({
  resolution: z.boolean()
});

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
      positions: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });

  res.json(
    markets.map((market) => ({
      ...market,
      summary: calculateMarketSummary(market, market.positions)
    }))
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
      positions: true
    }
  });

  res.status(201).json({
    ...market,
    summary: calculateMarketSummary(market, market.positions)
  });
}));

marketsRouter.post("/:marketId/positions", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const marketId = z.string().parse(req.params.marketId);
  const input = createPositionSchema.parse(req.body);

  const market = await prisma.market.findUnique({
    where: { id: marketId }
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

  const position = await prisma.position.create({
    data: {
      marketId,
      userId: currentUser.id,
      side: input.side,
      amount: input.amount
    }
  });

  res.status(201).json(position);
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

  const updated = await prisma.market.update({
    where: { id: marketId },
    data: {
      status: MarketStatus.RESOLVED,
      resolution: input.resolution,
      resolvesAt: market.resolvesAt ?? new Date()
    },
    include: {
      createdBy: true,
      targetUser: true,
      positions: true
    }
  });

  res.json({
    ...updated,
    summary: calculateMarketSummary(updated, updated.positions)
  });
}));
