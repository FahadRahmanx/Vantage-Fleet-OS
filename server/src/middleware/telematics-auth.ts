import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import prisma from "../lib/prisma";

declare global {
  namespace Express {
    interface Request {
      telematicsCompanyId?: string;
    }
  }
}

/**
 * authenticateTelematics — a per-company bearer token, not the user JWT.
 * A telematics provider isn't a logged-in user, so this is checked
 * separately from authenticate()/AuthPayload. Constant-time comparison
 * (crypto.timingSafeEqual) — cheap insurance even for a mocked endpoint,
 * not scope creep.
 */
export async function authenticateTelematics(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  const token = header.slice(7);

  const companies = await prisma.company.findMany({ where: { telematicsApiKey: { not: null } } });
  const match = companies.find((c) => {
    const key = c.telematicsApiKey!;
    if (key.length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(token));
  });

  if (!match) {
    return res.status(401).json({ error: "Invalid telematics API key" });
  }

  req.telematicsCompanyId = match.id;
  next();
}
