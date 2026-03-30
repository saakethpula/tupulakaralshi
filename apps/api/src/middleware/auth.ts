import { auth } from "express-oauth2-jwt-bearer";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config.js";
import { prisma } from "../db.js";

type AuthClaims = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  [key: string]: unknown;
};

const AUTH0_CLAIM_NAMESPACES = [
  "https://family-market-api/",
  "https://family-market-api"
];

function getClaim(claims: AuthClaims | undefined, claim: "email" | "name" | "picture") {
  if (!claims) {
    return undefined;
  }

  const directClaim = claims[claim];
  if (typeof directClaim === "string" && directClaim.length > 0) {
    return directClaim;
  }

  for (const namespace of AUTH0_CLAIM_NAMESPACES) {
    const namespacedClaim = claims[`${namespace}${claim}`];
    if (typeof namespacedClaim === "string" && namespacedClaim.length > 0) {
      return namespacedClaim;
    }
  }

  return undefined;
}

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
    const email = getClaim(claims, "email");
    const name = getClaim(claims, "name");
    const picture = getClaim(claims, "picture");
    if (!claims?.sub || !email) {
      const missingClaims = [
        !claims?.sub ? "sub" : null,
        !email ? "email" : null
      ].filter(Boolean);

      return res.status(401).json({
        message: `Missing Auth0 claims: ${missingClaims.join(", ")}.`,
        hint: "Configure Auth0 to include the required claims in the access token for this API."
      });
    }

    const auth0UserId = claims.sub;

    const user = await prisma.user.upsert({
      where: { auth0UserId },
      update: {
        email,
        displayName: name ?? email.split("@")[0],
        avatarUrl: picture
      },
      create: {
        auth0UserId,
        email,
        displayName: name ?? email.split("@")[0],
        avatarUrl: picture
      }
    });

    req.currentUser = user;
    next();
  } catch (error) {
    next(error);
  }
}
