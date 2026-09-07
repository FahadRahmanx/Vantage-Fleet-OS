import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { WorkflowError } from "../services/eligibility";
import { requireCapability, canManageUsers } from "../middleware/permissions";
import { inviteUser, resendInvite } from "../services/users";

const router = Router();

function handleUserError(e: unknown, res: Response) {
  if (e instanceof WorkflowError) {
    const status = e.message.includes("not found") ? 404 : 400;
    return res.status(status).json({ error: e.message });
  }
  throw e;
}

// passwordHash never leaves the server, even hashed — every route below
// that returns a User row runs it through this first.
function sanitizeUser<T extends { passwordHash: string }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash, ...rest } = user;
  return rest;
}

/**
 * GET /api/users
 * FR-7 — searchable/filterable user list, company-scoped.
 */
router.get("/", requireCapability(canManageUsers), async (req: Request, res: Response) => {
  const { role, status, q } = req.query;
  const where: Record<string, unknown> = { companyId: req.auth!.companyId };
  if (typeof role === "string") where.role = role;
  if (typeof status === "string") where.status = status;
  if (typeof q === "string" && q.trim()) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const users = await prisma.user.findMany({ where, orderBy: { createdAt: "desc" } });
  res.json(users.map(sanitizeUser));
});

const USER_WRITABLE_FIELDS = ["role", "carrierCompanyId", "platformAdmin"] as const;

/**
 * PATCH /api/users/:id
 * FR-7 — edit role, carrierCompanyId (never the top-level companyId), and
 * the platformAdmin flag. carrierCompanyId actually lives on Driver (not
 * User) in this schema, so it's applied to the target's linked Driver row
 * when present, and silently no-ops for a non-driver user.
 */
router.patch("/:id", requireCapability(canManageUsers), async (req: Request, res: Response) => {
  const target = await prisma.user.findFirst({ where: { id: req.params.id as string, companyId: req.auth!.companyId } });
  if (!target) return res.status(404).json({ error: "User not found" });

  const body = req.body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const field of USER_WRITABLE_FIELDS) {
    if (field === "carrierCompanyId") continue; // applied to Driver below, not User
    if (body[field] !== undefined) data[field] = body[field];
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = Object.keys(data).length > 0
      ? await tx.user.update({ where: { id: target.id }, data })
      : target;

    if (body.carrierCompanyId !== undefined && user.driverId) {
      await tx.driver.update({ where: { id: user.driverId }, data: { carrierCompanyId: body.carrierCompanyId as string } });
    }

    return user;
  });

  res.json(sanitizeUser(updated));
});

/**
 * POST /api/users/invite
 */
router.post("/invite", requireCapability(canManageUsers), async (req: Request, res: Response) => {
  const { firstName, lastName, email, role, carrierCompanyId, driverId } = req.body;
  if (!firstName || !lastName || !email || !role) {
    return res.status(400).json({ error: "firstName, lastName, email, and role are required" });
  }

  try {
    const user = await inviteUser({ firstName, lastName, email, role, carrierCompanyId, driverId, companyId: req.auth!.companyId });
    res.status(201).json(sanitizeUser(user));
  } catch (e) {
    handleUserError(e, res);
  }
});

/**
 * POST /api/users/:id/resend-invite
 */
router.post("/:id/resend-invite", requireCapability(canManageUsers), async (req: Request, res: Response) => {
  try {
    const user = await resendInvite(req.params.id as string, req.auth!.companyId);
    res.json(sanitizeUser(user));
  } catch (e) {
    handleUserError(e, res);
  }
});

export default router;
