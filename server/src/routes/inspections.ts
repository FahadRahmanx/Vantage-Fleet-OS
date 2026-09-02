import { Router, Request, Response } from "express";
import { requireCapability, canSubmitInspection } from "../middleware/permissions";
import { submitInspection } from "../services/inspections";
import { WorkflowError, EligibilityError } from "../services/eligibility";

const router = Router();

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
