import { GroupRole } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { createJoinCode } from "../lib/join-code.js";
import { notifyGroupMembers, notifyUsers } from "../lib/realtime.js";
import { asyncHandler } from "../middleware/async-handler.js";

export const groupsRouter = Router();

const createGroupSchema = z.object({
  name: z.string().min(2).max(80)
});

const joinGroupSchema = z.object({
  joinCode: z.string().min(6).max(12)
});

const updateBetLimitsSchema = z.object({
  minBet: z.coerce.number().int().min(1).max(15),
  maxBet: z.coerce.number().int().min(1).max(15),
  requireVenmoForBets: z.coerce.boolean().optional()
}).refine((value) => value.minBet <= value.maxBet, {
  message: "Minimum bet must be less than or equal to maximum bet."
});

type AdminMembershipCheck =
  | { ok: true; membership: { role: GroupRole } }
  | { ok: false; error: { status: number; message: string } };

async function requireAdminMembership(groupId: string, userId: string): Promise<AdminMembershipCheck> {
  const membership = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: {
        userId,
        groupId
      }
    }
  });

  if (!membership) {
    return { ok: false, error: { status: 404, message: "Family group not found." } };
  }

  if (membership.role !== GroupRole.ADMIN) {
    return { ok: false, error: { status: 403, message: "Only group admins can manage members." } };
  }

  return { ok: true, membership };
}

function getParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

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

  void notifyUsers([currentUser.id], "group.created", [group.id]);
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

  void notifyGroupMembers(group.id, "group.joined");
  return res.json({ joined: true, groupId: group.id });
}));

groupsRouter.delete("/:groupId/members/:memberId", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const groupId = getParam(req.params.groupId);
  const memberId = getParam(req.params.memberId);

  const adminCheck = await requireAdminMembership(groupId, currentUser.id);

  if (!adminCheck.ok) {
    return res.status(adminCheck.error.status).json({ message: adminCheck.error.message });
  }

  if (memberId === currentUser.id) {
    return res.status(400).json({ message: "Admins cannot remove themselves. Delete the group instead." });
  }

  const membershipToRemove = await prisma.groupMembership.findUnique({
    where: {
      userId_groupId: {
        userId: memberId,
        groupId
      }
    }
  });

  if (!membershipToRemove) {
    return res.status(404).json({ message: "Group member not found." });
  }

  await prisma.groupMembership.delete({
    where: {
      userId_groupId: {
        userId: memberId,
        groupId
      }
    }
  });

  void notifyGroupMembers(groupId, "group.member_removed");
  void notifyUsers([memberId], "group.removed", [groupId]);

  return res.json({ removed: true });
}));

groupsRouter.patch("/:groupId/bet-limits", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const groupId = getParam(req.params.groupId);
  const input = updateBetLimitsSchema.parse(req.body);
  const adminCheck = await requireAdminMembership(groupId, currentUser.id);

  if (!adminCheck.ok) {
    return res.status(adminCheck.error.status).json({ message: adminCheck.error.message });
  }

  const group = await prisma.familyGroup.update({
    where: { id: groupId },
    data: {
      minBet: input.minBet,
      maxBet: input.maxBet,
      ...(input.requireVenmoForBets === undefined ? {} : { requireVenmoForBets: input.requireVenmoForBets })
    }
  });

  void notifyGroupMembers(groupId, "group.bet_limits.updated");
  return res.json({ group });
}));

groupsRouter.delete("/:groupId", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const groupId = getParam(req.params.groupId);

  const adminCheck = await requireAdminMembership(groupId, currentUser.id);

  if (!adminCheck.ok) {
    return res.status(adminCheck.error.status).json({ message: adminCheck.error.message });
  }

  const memberIds = await prisma.groupMembership.findMany({
    where: { groupId },
    select: { userId: true }
  });

  await prisma.familyGroup.delete({
    where: { id: groupId }
  });

  void notifyUsers(memberIds.map((membership) => membership.userId), "group.deleted", [groupId]);

  return res.json({ deleted: true });
}));
