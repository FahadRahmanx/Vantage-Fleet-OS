import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canReadFleetRoster, canManageFleetRoster } from "../middleware/permissions";

const router = Router();

// dataSource and lastTelematicsUpdateAt are deliberately absent — those
// stay system-managed by the telematics ingest path only (spec §5).
const VEHICLE_WRITABLE_FIELDS = [
  "vin", "unitNumber", "make", "model", "year", "plate", "fuelType",
  "odometer", "engineHours", "registrationExpiry", "insuranceExpiry",
  "status", "homeTerminal", "carrierCompanyId", "type",
] as const;

function pickVehicleFields(body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const field of VEHICLE_WRITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    if (field === "registrationExpiry" || field === "insuranceExpiry") {
      picked[field] = body[field] ? new Date(body[field] as string) : null;
    } else {
      picked[field] = body[field];
    }
  }
  return picked;
}

/**
 * GET /api/vehicles
 * List vehicles scoped to the authenticated user's company.
 */
router.get("/", requireCapability(canReadFleetRoster), async (req: Request, res: Response) => {
  const vehicles = await prisma.vehicle.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { plate: "asc" },
  });
  res.json(vehicles);
});

/**
 * POST /api/vehicles
 * FR-9. Body: { vin, unitNumber, make, model, plate, ...whitelisted optional fields }
 */
router.post("/", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const { vin, unitNumber, make, model, plate } = req.body;
  if (!vin || !unitNumber || !make || !model || !plate) {
    return res.status(400).json({ error: "vin, unitNumber, make, model, and plate are required" });
  }

  const fields = pickVehicleFields(req.body);

  try {
    const vehicle = await prisma.vehicle.create({
      data: { companyId: req.auth!.companyId, ...fields, vin, unitNumber, make, model, plate },
    });
    res.status(201).json(vehicle);
  } catch (e: any) {
    if (e?.code === "P2002") {
      return res.status(409).json({ error: "A vehicle with this VIN already exists" });
    }
    throw e;
  }
});

/**
 * PATCH /api/vehicles/:id
 * FR-9. Body: any subset of the whitelisted fields.
 */
router.patch("/:id", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const existing = await prisma.vehicle.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Vehicle not found" });
  }

  const fields = pickVehicleFields(req.body);

  try {
    const updated = await prisma.vehicle.update({ where: { id: existing.id }, data: fields });
    res.json(updated);
  } catch (e: any) {
    if (e?.code === "P2002") {
      return res.status(409).json({ error: "A vehicle with this VIN already exists" });
    }
    throw e;
  }
});

export default router;
