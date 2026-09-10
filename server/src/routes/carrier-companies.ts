import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canManageUsers, canManageFleetRoster } from "../middleware/permissions";

const router = Router();

const CARRIER_WRITABLE_FIELDS = ["name", "contactName", "contactEmail", "documentExpiryAlertDays", "defaultVehicleId"] as const;

function pickCarrierFields(body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const field of CARRIER_WRITABLE_FIELDS) {
    if (body[field] !== undefined) picked[field] = body[field];
  }
  return picked;
}

/**
 * GET /api/carrier-companies
 * Reference data for the invite form's carrier dropdown (FR-6).
 */
router.get("/", requireCapability(canManageUsers), async (req: Request, res: Response) => {
  const carriers = await prisma.carrierCompany.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { name: "asc" },
  });
  res.json(carriers);
});

/**
 * POST /api/carrier-companies
 * FR-8. Body: { name, contactName?, contactEmail?, documentExpiryAlertDays?, defaultVehicleId? }
 */
router.post("/", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const fields = pickCarrierFields(req.body);
  if (typeof fields.defaultVehicleId === "string") {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: fields.defaultVehicleId, companyId: req.auth!.companyId } });
    if (!vehicle) {
      return res.status(404).json({ error: "defaultVehicleId does not reference a vehicle in your company" });
    }
  }

  const carrier = await prisma.carrierCompany.create({
    data: { companyId: req.auth!.companyId, ...fields, name },
  });
  res.status(201).json(carrier);
});

/**
 * PATCH /api/carrier-companies/:id
 * FR-8. Body: any subset of the whitelisted fields.
 */
router.patch("/:id", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const existing = await prisma.carrierCompany.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Carrier company not found" });
  }

  const fields = pickCarrierFields(req.body);
  if (typeof fields.defaultVehicleId === "string") {
    const vehicle = await prisma.vehicle.findFirst({ where: { id: fields.defaultVehicleId, companyId: req.auth!.companyId } });
    if (!vehicle) {
      return res.status(404).json({ error: "defaultVehicleId does not reference a vehicle in your company" });
    }
  }

  const updated = await prisma.carrierCompany.update({ where: { id: existing.id }, data: fields });
  res.json(updated);
});

export default router;
