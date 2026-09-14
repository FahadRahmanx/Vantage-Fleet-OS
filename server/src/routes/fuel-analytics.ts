import { Router, Request, Response } from "express";
import { requireCapability, canReadFleetRoster } from "../middleware/permissions";
import { estimateFuelConsumption } from "../services/fuel-analytics";

const router = Router();

/**
 * GET /api/fuel-analytics/estimate?distanceMiles=&vehicleType=&actualGallonsUsed=
 * FR-56. Read-only calculator; not wired into any other screen.
 */
router.get("/estimate", requireCapability(canReadFleetRoster), (req: Request, res: Response) => {
  const distanceMiles = Number(req.query.distanceMiles);
  const vehicleType = typeof req.query.vehicleType === "string" ? req.query.vehicleType : undefined;
  const actualGallonsUsed = req.query.actualGallonsUsed !== undefined ? Number(req.query.actualGallonsUsed) : undefined;

  if (!Number.isFinite(distanceMiles) || distanceMiles < 0 || !vehicleType) {
    return res.status(400).json({ error: "distanceMiles (a non-negative number) and vehicleType are required" });
  }
  if (actualGallonsUsed !== undefined && !Number.isFinite(actualGallonsUsed)) {
    return res.status(400).json({ error: "actualGallonsUsed must be a number" });
  }

  const estimate = estimateFuelConsumption(distanceMiles, vehicleType, actualGallonsUsed);
  res.json(estimate);
});

export default router;
