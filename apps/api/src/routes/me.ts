import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { notifyUserGroups } from "../lib/realtime.js";
import { asyncHandler } from "../middleware/async-handler.js";

export const meRouter = Router();

const updateVenmoSchema = z.object({
  venmoHandle: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => value.replace(/^@+/, ""))
});

const updateTutorialSchema = z.object({
  completed: z.boolean()
});

type UserWithVenmo = {
  venmoHandle: string | null;
  hasCompletedTutorial: boolean;
};

meRouter.get("/", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const currentUserWithVenmo = currentUser as typeof currentUser & UserWithVenmo;

  const memberships = await prisma.groupMembership.findMany({
    where: { userId: currentUser.id },
    include: {
      group: {
        include: {
          memberships: {
            include: {
              user: true
            }
          }
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  res.json({
    user: {
      ...currentUser,
      balance: currentUser.balance,
      venmoHandle: currentUserWithVenmo.venmoHandle,
      hasCompletedTutorial: currentUserWithVenmo.hasCompletedTutorial
    },
    groups: memberships.map((membership) => ({
      id: membership.group.id,
      name: membership.group.name,
      joinCode: membership.group.joinCode,
      minBet: membership.group.minBet,
      maxBet: membership.group.maxBet,
      requireVenmoForBets: membership.group.requireVenmoForBets,
      role: membership.role,
      members: membership.group.memberships.map((groupMembership) => ({
        id: groupMembership.user.id,
        displayName: groupMembership.user.displayName,
        email: groupMembership.user.email,
        avatarUrl: groupMembership.user.avatarUrl,
        venmoHandle: (groupMembership.user as typeof groupMembership.user & UserWithVenmo).venmoHandle,
        role: groupMembership.role,
        balance: groupMembership.user.balance
      }))
    }))
  });
}));

meRouter.patch("/", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const input = updateVenmoSchema.parse(req.body);

  const updatedUser = await prisma.user.update({
    where: { id: currentUser.id },
    data: {
      venmoHandle: input.venmoHandle
    } as never
  });

  req.currentUser = updatedUser;

  void notifyUserGroups(currentUser.id, "profile.updated");
  res.json({
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.displayName,
      avatarUrl: updatedUser.avatarUrl,
      balance: updatedUser.balance,
      venmoHandle: (updatedUser as typeof updatedUser & UserWithVenmo).venmoHandle,
      hasCompletedTutorial: (updatedUser as typeof updatedUser & UserWithVenmo).hasCompletedTutorial
    }
  });
}));

meRouter.patch("/tutorial", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;
  const input = updateTutorialSchema.parse(req.body);

  const updatedUser = await prisma.user.update({
    where: { id: currentUser.id },
    data: {
      hasCompletedTutorial: input.completed
    } as never
  });

  req.currentUser = updatedUser;

  res.json({
    user: {
      id: updatedUser.id,
      email: updatedUser.email,
      displayName: updatedUser.displayName,
      avatarUrl: updatedUser.avatarUrl,
      balance: updatedUser.balance,
      venmoHandle: (updatedUser as typeof updatedUser & UserWithVenmo).venmoHandle,
      hasCompletedTutorial: (updatedUser as typeof updatedUser & UserWithVenmo).hasCompletedTutorial
    }
  });
}));
