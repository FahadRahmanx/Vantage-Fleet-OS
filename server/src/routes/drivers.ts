import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canReadFleetRoster } from "../middleware/permissions";
import { checkEligibility } from "../services/eligibility";

const router = Router();

/**
 * GET /api/drivers
 * List drivers scoped to the authenticated user's company.
 */
router.get("/", requireCapability(canReadFleetRoster), async (req: Request, res: Response) => {
  const drivers = await prisma.driver.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { name: "asc" },
  });
  res.json(drivers);
});

/**
 * GET /api/drivers/:id/eligibility?vehicleId=
 * Read-only preview of checkEligibility() for the assignment form's live
 * panel — reuses the exact authoritative check assignDriver() runs, so the
 * preview can never drift from what actually gets enforced on submit.
 */
router.get("/:id/eligibility", async (req: Request, res: Response) => {
  const driver = await prisma.driver.findFirst({ where: { id: req.params.id as string, companyId: req.auth!.companyId } });
  if (!driver) {
    return res.status(404).json({ error: "Driver not found" });
  }

  const vehicleId = typeof req.query.vehicleId === "string" ? req.query.vehicleId : undefined;
  const result = await checkEligibility(req.params.id as string, vehicleId);
  res.json(result);
});

export default router;
