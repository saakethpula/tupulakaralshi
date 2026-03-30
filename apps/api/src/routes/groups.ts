import { GroupRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { createJoinCode } from "../lib/join-code.js";
import { asyncHandler } from "../middleware/async-handler.js";

export const groupsRouter = Router();

const createGroupSchema = z.object({
  name: z.string().min(2).max(80)
});

const joinGroupSchema = z.object({
  joinCode: z.string().min(6).max(12)
});

const updateBalanceSchema = z.object({
  amount: z.coerce.number().int().min(1).max(100000)
});

groupsRouter.post("/", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const input = createGroupSchema.parse(req.body);

  const group = await prisma.familyGroup.create({
    data: {
      name: input.name,
      joinCode: createJoinCode(),
      memberships: {
        create: {
          userId: currentUser.id,
          role: GroupRole.ADMIN
        }
      }
    }
  });

  res.status(201).json(group);
}));

groupsRouter.post("/join", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const input = joinGroupSchema.parse(req.body);

  const group = await prisma.familyGroup.findUnique({
    where: {
      joinCode: input.joinCode.toUpperCase()
    }
  });

  if (!group) {
    return res.status(404).json({ message: "Family group not found." });
  }

  await prisma.groupMembership.upsert({
    where: {
      userId_groupId: {
        userId: currentUser.id,
        groupId: group.id
      }
    },
    update: {},
    create: {
      userId: currentUser.id,
      groupId: group.id
    }
  });

  return res.json({ joined: true, groupId: group.id });
}));

groupsRouter.patch("/:groupId/balance", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const groupId = z.string().parse(req.params.groupId);
  const input = updateBalanceSchema.parse(req.body);

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

  const updatedUser = await prisma.user.update({
    where: { id: currentUser.id },
    data: {
      balance: {
        increment: input.amount
      }
    }
  });

  return res.json({ balance: updatedUser.balance });
}));
