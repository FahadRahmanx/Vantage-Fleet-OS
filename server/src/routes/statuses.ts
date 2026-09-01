import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canConfigureWorkflow } from "../middleware/permissions";

const router = Router();

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
 * Body: { name, code, position, color?, isDefault?, isDispatchStatus?,
 *         isInTransitStatus?, isFlaggedStatus?, isInRepairStatus?,
 *         isComplianceReviewQueue?, isOutOfServiceEligible?,
 *         isOutOfServiceDefault?, requiresEligibilityCheck?, roleVisibility? }
 * FR-23: create a new status without a deploy.
 */
router.post("/", requireCapability(canConfigureWorkflow), async (req: Request, res: Response) => {
  const { name, code, position, ...flags } = req.body;
  if (!name || !code || position === undefined) {
    return res.status(400).json({ error: "name, code, and position are required" });
  }

  const status = await prisma.dispatchStatus.create({
    data: { name, code, position, companyId: req.auth!.companyId, ...flags },
  });
  res.status(201).json(status);
});

/**
 * PATCH /api/statuses/:id
 * Body: any subset of the status fields.
 * FR-25: basic status editing (no drag-to-reorder, no flowchart diagram).
 */
router.patch("/:id", requireCapability(canConfigureWorkflow), async (req: Request, res: Response) => {
  const existing = await prisma.dispatchStatus.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Status not found" });
  }

  const status = await prisma.dispatchStatus.update({
    where: { id: req.params.id as string },
    data: req.body,
  });
  res.json(status);
});

/**
 * GET /api/transitions
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
 * FR-24: create a new allowed edge without a deploy. The DB's two partial
 * unique indexes (one default target per from-status, one transition per
 * outcome per from-status) make ambiguous auto-routing impossible — a
 * violation surfaces here as a 400, not a 500.
 */
router.post("/transitions", requireCapability(canConfigureWorkflow), async (req: Request, res: Response) => {
  const { fromStatusId, toStatusId, outcomeTrigger, isDefaultTarget } = req.body;
  if (!fromStatusId || !toStatusId) {
    return res.status(400).json({ error: "fromStatusId and toStatusId are required" });
  }

  try {
    const transition = await prisma.dispatchTransition.create({
      data: { fromStatusId, toStatusId, outcomeTrigger, isDefaultTarget, companyId: req.auth!.companyId },
    });
    res.status(201).json(transition);
  } catch (e: any) {
    if (e?.code === "P2002") {
      return res.status(400).json({ error: "A transition with this default-target or outcome-trigger already exists from this status" });
    }
    throw e;
  }
});

export default router;
