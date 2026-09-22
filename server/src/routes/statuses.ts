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
  "loadListColumns",
] as const;

function pickStatusFields(body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const field of STATUS_WRITABLE_FIELDS) {
    if (body[field] !== undefined) picked[field] = body[field];
  }
  return picked;
}

// P2002 on a status write can come from two different constraints —
// @@unique([code, companyId]) or the hand-added partial unique index that
// enforces one isDefault status per company — distinguish them so the
// error actually points at what went wrong.
function statusConflictMessage(e: any): string {
  const target = e?.meta?.target;
  const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "");
  if (targetStr.includes("one_default")) {
    return "This company already has a default status — unset the existing one first";
  }
  return "A status with this code already exists";
}

/**
 * GET /api/statuses
 * List all dispatch statuses for the authenticated user's company.
 */
router.get("/", async (req: Request, res: Response) => {
  const includeArchived = req.query.includeArchived === "true";
  const statuses = await prisma.dispatchStatus.findMany({
    where: { companyId: req.auth!.companyId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: { position: "asc" },
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
      return res.status(400).json({ error: statusConflictMessage(e) });
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
      return res.status(400).json({ error: statusConflictMessage(e) });
    }
    throw e;
  }
});

/**
 * PATCH /api/statuses/reorder
 * FR-25. Body: { orderedIds: string[] } — every status id for this
 * company, in the desired order. Resequences position to the array
 * index for each, in one transaction.
 */
router.patch("/reorder", requireCapability(canConfigureWorkflow), async (req: Request, res: Response) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: "orderedIds must be a non-empty array" });
  }

  const companyId = req.auth!.companyId;
  const owned = await prisma.dispatchStatus.findMany({ where: { id: { in: orderedIds }, companyId } });
  if (owned.length !== orderedIds.length) {
    return res.status(400).json({ error: "orderedIds must all belong to your company" });
  }

  await prisma.$transaction(
    orderedIds.map((id: string, index: number) =>
      prisma.dispatchStatus.update({ where: { id }, data: { position: index } })
    )
  );
  const statuses = await prisma.dispatchStatus.findMany({ where: { companyId, archived: false }, orderBy: { position: "asc" } });
  res.json(statuses);
});

/**
 * PATCH /api/statuses/:id/archive
 * FR-25. Rejected when the status is the default or a dispatch status —
 * a workflow with no starting status or no dispatch-board entry point
 * is broken.
 */
router.patch("/:id/archive", requireCapability(canConfigureWorkflow), async (req: Request, res: Response) => {
  const existing = await prisma.dispatchStatus.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Status not found" });
  }
  if (existing.isDefault) {
    return res.status(400).json({ error: "Cannot archive the default status" });
  }
  if (existing.isDispatchStatus) {
    return res.status(400).json({ error: "Cannot archive a dispatch status" });
  }

  const status = await prisma.dispatchStatus.update({ where: { id: existing.id }, data: { archived: true } });
  res.json(status);
});

/**
 * PATCH /api/statuses/:id/unarchive
 * FR-25.
 */
router.patch("/:id/unarchive", requireCapability(canConfigureWorkflow), async (req: Request, res: Response) => {
  const existing = await prisma.dispatchStatus.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Status not found" });
  }

  const status = await prisma.dispatchStatus.update({ where: { id: existing.id }, data: { archived: false } });
  res.json(status);
});

/**
 * DELETE /api/statuses/:id
 * FR-25. Hard-delete, only when genuinely never used — no Load
 * currently in this status, and no LoadStatusLog row references it.
 */
router.delete("/:id", requireCapability(canConfigureWorkflow), async (req: Request, res: Response) => {
  const existing = await prisma.dispatchStatus.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Status not found" });
  }

  const [loadsUsingIt, logsUsingIt] = await Promise.all([
    prisma.load.count({ where: { currentStatusId: existing.id } }),
    prisma.loadStatusLog.count({ where: { OR: [{ fromStatusId: existing.id }, { toStatusId: existing.id }] } }),
  ]);
  if (loadsUsingIt > 0 || logsUsingIt > 0) {
    return res.status(400).json({ error: "Cannot delete a status that has been used by any load — archive it instead" });
  }

  await prisma.dispatchTransition.deleteMany({ where: { OR: [{ fromStatusId: existing.id }, { toStatusId: existing.id }] } });
  await prisma.dispatchStatus.delete({ where: { id: existing.id } });
  res.json({ ok: true });
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
