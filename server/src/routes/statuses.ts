import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canConfigureWorkflow } from "../middleware/permissions";

const router = Router();

// Explicit field whitelist for status writes — never spread req.body
// directly into a Prisma `data` object. companyId/id must never be
// client-settable, or a caller can write into another tenant's workflow.
const STATUS_WRITABLE_FIELDS = [
  "color",
  "isDefault",
  "isDispatchStatus",
  "isInTransitStatus",
  "isFlaggedStatus",
  "isInRepairStatus",
  "isComplianceReviewQueue",
  "isOutOfServiceEligible",
  "isOutOfServiceDefault",
  "requiresEligibilityCheck",
  "roleVisibility",
  "requiredFields",
] as const;

function pickStatusFields(body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const field of STATUS_WRITABLE_FIELDS) {
    if (body[field] !== undefined) picked[field] = body[field];
  }
  return picked;
}

/**
 * GET /api/statuses
 * List all dispatch statuses for the authenticated user's company.
 */
router.get("/", async (req: Request, res: Response) => {
  const statuses = await prisma.dispatchStatus.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { code: "asc" },
  });
  res.json(statuses);
});

/**
 * POST /api/statuses
 * Body: { name, code, position, ...any of the whitelisted flag fields }
 * FR-23: create a new status without a deploy. roleVisibility defaults to
 * [dispatcher, fleet_admin] when omitted — an empty roleVisibility would
 * make the status a dead end nothing but platformAdmin could ever leave.
 */
router.post("/", requireCapability(canConfigureWorkflow), async (req: Request, res: Response) => {
  const { name, code, position } = req.body;
  if (!name || !code || position === undefined) {
    return res.status(400).json({ error: "name, code, and position are required" });
  }

  const fields = pickStatusFields(req.body);
  if (fields.roleVisibility === undefined) {
    fields.roleVisibility = ["dispatcher", "fleet_admin"];
  }

  try {
    const status = await prisma.dispatchStatus.create({
      data: { name, code, position, companyId: req.auth!.companyId, ...fields },
    });
    res.status(201).json(status);
  } catch (e: any) {
    if (e?.code === "P2002") {
      return res.status(400).json({ error: "A status with this code already exists" });
    }
    throw e;
  }
});

/**
 * PATCH /api/statuses/:id
 * Body: any subset of the whitelisted status fields.
 * FR-25: basic status editing (no drag-to-reorder, no flowchart diagram).
 */
router.patch("/:id", requireCapability(canConfigureWorkflow), async (req: Request, res: Response) => {
  const existing = await prisma.dispatchStatus.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Status not found" });
  }

  try {
    const status = await prisma.dispatchStatus.update({
      where: { id: req.params.id as string },
      data: pickStatusFields(req.body),
    });
    res.json(status);
  } catch (e: any) {
    if (e?.code === "P2002") {
      return res.status(400).json({ error: "A status with this code already exists" });
    }
    throw e;
  }
});

/**
 * GET /api/statuses/transitions
 * List all dispatch transitions for the authenticated user's company.
 */
router.get("/transitions", async (req: Request, res: Response) => {
  const transitions = await prisma.dispatchTransition.findMany({
    where: { companyId: req.auth!.companyId },
    include: {
      fromStatus: { select: { id: true, code: true, name: true } },
      toStatus: { select: { id: true, code: true, name: true } },
    },
    orderBy: { fromStatus: { code: "asc" } },
  });
  res.json(transitions);
});

/**
 * POST /api/statuses/transitions
 * Body: { fromStatusId, toStatusId, outcomeTrigger?, isDefaultTarget? }
 * FR-24: create a new allowed edge without a deploy. Both endpoints must
 * belong to the caller's company — otherwise a transition could point a
 * load's status at a row another tenant controls. The DB's two partial
 * unique indexes (one default target per from-status, one transition per
 * outcome per from-status) make ambiguous auto-routing impossible — a
 * violation surfaces here as a 400, not a 500.
 */
router.post("/transitions", requireCapability(canConfigureWorkflow), async (req: Request, res: Response) => {
  const { fromStatusId, toStatusId, outcomeTrigger, isDefaultTarget } = req.body;
  if (!fromStatusId || !toStatusId) {
    return res.status(400).json({ error: "fromStatusId and toStatusId are required" });
  }

  const companyId = req.auth!.companyId;
  const [fromStatus, toStatus] = await Promise.all([
    prisma.dispatchStatus.findFirst({ where: { id: fromStatusId, companyId } }),
    prisma.dispatchStatus.findFirst({ where: { id: toStatusId, companyId } }),
  ]);
  if (!fromStatus || !toStatus) {
    return res.status(400).json({ error: "fromStatusId and toStatusId must both belong to your company" });
  }

  try {
    const transition = await prisma.dispatchTransition.create({
      data: { fromStatusId, toStatusId, outcomeTrigger, isDefaultTarget, companyId },
    });
    res.status(201).json(transition);
  } catch (e: any) {
    if (e?.code === "P2002") {
      const target = e?.meta?.target as string[] | string | undefined;
      const message = Array.isArray(target) && target.includes("outcome_trigger")
        ? "A transition for this outcome already exists from this status"
        : Array.isArray(target) && target.includes("is_default_target")
        ? "A default-target transition already exists from this status"
        : "This transition already exists";
      return res.status(400).json({ error: message });
    }
    throw e;
  }
});

export default router;
