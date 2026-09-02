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
 * canReadFleetRoster — everyone except a plain `driver` role (platformAdmin
 * always passes). Drivers don't need the full company roster; they only
 * need their own profile, which no Phase 0 route exposes yet.
 */
export function canReadFleetRoster(auth: AuthPayload): boolean {
  return auth.platformAdmin || auth.role !== "driver";
}

/**
 * canConfigureWorkflow — fleet_admin/platformAdmin only. Gates the
 * Workflow Configuration write routes (FR-23/24/25).
 */
export function canConfigureWorkflow(auth: AuthPayload): boolean {
  return auth.platformAdmin || auth.role === "fleet_admin";
}

/**
 * canComplianceWrite — compliance_officer/fleet_admin/platformAdmin. Gates
 * finalizing a route's compliance review (FR-41/42).
 */
export function canComplianceWrite(auth: AuthPayload): boolean {
  return auth.platformAdmin || auth.role === "compliance_officer" || auth.role === "fleet_admin";
}

/**
 * canSubmitInspection — driver/dispatcher/fleet_admin/platformAdmin. A DVIR
 * (FR-28) is normally filled out by the driver on the ground, not just
 * dispatch staff, so this is deliberately broader than canDispatchWrite.
 */
export function canSubmitInspection(auth: AuthPayload): boolean {
  return auth.platformAdmin || auth.role === "driver" || auth.role === "dispatcher" || auth.role === "fleet_admin";
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
