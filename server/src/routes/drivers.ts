import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canReadFleetRoster, canManageFleetRoster } from "../middleware/permissions";
import { checkEligibility } from "../services/eligibility";

const router = Router();

const DRIVER_WRITABLE_FIELDS = [
  "name", "licenseExpiry", "licenseClass", "endorsements", "medicalCertExpiry",
  "homeTerminal", "hosRulesetId", "adminStatus", "carrierCompanyId",
] as const;

function pickDriverFields(body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const field of DRIVER_WRITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    if (field === "licenseExpiry" || field === "medicalCertExpiry") {
      picked[field] = new Date(body[field] as string);
    } else {
      picked[field] = body[field];
    }
  }
  return picked;
}

/**
 * GET /api/drivers
 * List drivers scoped to the authenticated user's company.
 */
router.get("/", requireCapability(canReadFleetRoster), async (req: Request, res: Response) => {
  const where: Record<string, unknown> = { companyId: req.auth!.companyId };
  if (typeof req.query.carrierCompanyId === "string") where.carrierCompanyId = req.query.carrierCompanyId;
  if (req.query.unlinked === "true") where.user = null;

  const drivers = await prisma.driver.findMany({
    where,
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

/**
 * POST /api/drivers
 * FR-10. Body: { name, licenseExpiry, medicalCertExpiry, ...whitelisted optional fields }
 */
router.post("/", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const { name, licenseExpiry, medicalCertExpiry } = req.body;
  if (!name || !licenseExpiry || !medicalCertExpiry) {
    return res.status(400).json({ error: "name, licenseExpiry, and medicalCertExpiry are required" });
  }

  const fields = pickDriverFields(req.body);
  const driver = await prisma.driver.create({
    data: { companyId: req.auth!.companyId, ...fields, name, licenseExpiry: fields.licenseExpiry as Date, medicalCertExpiry: fields.medicalCertExpiry as Date },
  });
  res.status(201).json(driver);
});

/**
 * PATCH /api/drivers/:id
 * FR-10. Body: any subset of the whitelisted fields.
 */
router.patch("/:id", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const existing = await prisma.driver.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Driver not found" });
  }

  const fields = pickDriverFields(req.body);
  const updated = await prisma.driver.update({ where: { id: existing.id }, data: fields });
  res.json(updated);
});

export default router;
