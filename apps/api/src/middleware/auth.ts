import { auth } from "express-oauth2-jwt-bearer";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config.js";
import { prisma } from "../db.js";

type AuthClaims = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};

export const requireAuth = auth({
  audience: env.AUTH0_AUDIENCE,
  issuerBaseURL: env.AUTH0_ISSUER_BASE_URL,
  tokenSigningAlg: "RS256"
});

export async function attachCurrentUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const claims = req.auth?.payload as AuthClaims | undefined;
    const missingClaims = [
      !claims?.sub ? "sub" : null,
      !claims?.email ? "email" : null
    ].filter(Boolean);

    if (missingClaims.length > 0) {
      return res.status(401).json({
        message: `Missing Auth0 claims: ${missingClaims.join(", ")}.`,
        hint: "Configure Auth0 to include the required claims in the access token for this API."
      });
    }

    const user = await prisma.user.upsert({
      where: { auth0UserId: claims.sub },
      update: {
        email: claims.email,
        displayName: claims.name ?? claims.email.split("@")[0],
        avatarUrl: claims.picture
      },
      create: {
        auth0UserId: claims.sub,
        email: claims.email,
        displayName: claims.name ?? claims.email.split("@")[0],
        avatarUrl: claims.picture
      }
    });

    req.currentUser = user;
    next();
  } catch (error) {
    next(error);
  }
}
