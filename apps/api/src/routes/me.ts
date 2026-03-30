import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler } from "../middleware/async-handler.js";

export const meRouter = Router();

meRouter.get("/", asyncHandler(async (req, res) => {
  const currentUser = req.currentUser!;

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
    user: currentUser,
    groups: memberships.map((membership) => ({
      id: membership.group.id,
      name: membership.group.name,
      joinCode: membership.group.joinCode,
      role: membership.role,
      balance: membership.balance,
      members: membership.group.memberships.map((groupMembership) => ({
        id: groupMembership.user.id,
        displayName: groupMembership.user.displayName,
        email: groupMembership.user.email,
        avatarUrl: groupMembership.user.avatarUrl,
        role: groupMembership.role,
        balance: groupMembership.balance
      }))
    }))
  });
}));
