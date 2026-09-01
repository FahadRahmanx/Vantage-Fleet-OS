// server/src/middleware/permissions.ts
import { Request, Response, NextFunction } from "express";
import { AuthPayload } from "./auth";

/**
 * canDispatchWrite — dispatcher/fleet_admin/platformAdmin can create, edit,
 * assign, advance, or revert loads (FR-2's "derived capability rules must
 * be supported").
 */
export function canDispatchWrite(auth: AuthPayload): boolean {
  return auth.platformAdmin || auth.role === "dispatcher" || auth.role === "fleet_admin";
}

/**
 * requireCapability — Express middleware wrapping a capability check.
 */
export function requireCapability(check: (auth: AuthPayload) => boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!check(req.auth)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

/**
 * scopeLoadsForActor — a driver sees only their own assigned loads; every
 * other role (and platformAdmin) sees the whole company, unchanged from
 * the pre-driver-role behavior.
 */
export function scopeLoadsForActor<T extends Record<string, unknown>>(
  auth: AuthPayload,
  baseWhere: T
): T & { driverId?: string } {
  if (auth.role === "driver" && !auth.platformAdmin) {
    return { ...baseWhere, driverId: auth.driverId ?? "__none__" };
  }
  return baseWhere;
}
