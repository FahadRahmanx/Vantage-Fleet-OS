import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canSubmitInspection } from "../middleware/permissions";
import { submitInspection } from "../services/inspections";
import { WorkflowError, EligibilityError } from "../services/eligibility";

const router = Router();

/**
 * GET /api/inspections?loadId=
 * Submitted inspections, most recent first, with their defect entries.
 * FR-19: the load detail view shows its inspection history. A driver sees
 * only their own inspections, the same row scoping the loads list applies.
 */
router.get("/", async (req: Request, res: Response) => {
  const { loadId } = req.query;

  const where: { companyId: string; loadId?: string; driverId?: string } = {
    companyId: req.auth!.companyId,
  };
  if (typeof loadId === "string") where.loadId = loadId;
  if (req.auth!.role === "driver" && !req.auth!.platformAdmin) {
    where.driverId = req.auth!.driverId ?? "__none__";
  }

  const inspections = await prisma.inspection.findMany({
    where,
    include: {
      defects: { include: { defectCategory: { select: { name: true, outcome: true } } } },
      vehicle: { select: { unitNumber: true, plate: true } },
      driver: { select: { name: true } },
    },
    orderBy: { submittedAt: "desc" },
  });
  res.json(inspections);
});

/**
 * POST /api/inspections
 * Body: { loadId, vehicleId, driverId, type, odometerReading?, defectEntries[], overrideOutcome?, overrideReason? }
 * FR-28: single-call submit-and-advance.
 */
router.post("/", requireCapability(canSubmitInspection), async (req: Request, res: Response) => {
  const { loadId, vehicleId, driverId, type, odometerReading, defectEntries, overrideOutcome, overrideReason } = req.body;
  if (!loadId || !vehicleId || !driverId || !type || !Array.isArray(defectEntries)) {
    return res.status(400).json({ error: "loadId, vehicleId, driverId, type, and defectEntries are required" });
  }

  try {
    const result = await submitInspection({
      loadId, vehicleId, driverId, type, odometerReading, defectEntries, overrideOutcome, overrideReason,
      actorId: req.auth!.userId,
    });
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof EligibilityError) {
      return res.status(422).json({ error: "Driver not eligible", reason: e.message });
    }
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
});

export default router;
