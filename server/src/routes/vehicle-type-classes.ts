import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canReadFleetRoster, canManageFleetRoster } from "../middleware/permissions";

const router = Router();

const VEHICLE_TYPE_CLASS_WRITABLE_FIELDS = ["name", "classKind", "sourceMarker", "active"] as const;

function pickVehicleTypeClassFields(body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const field of VEHICLE_TYPE_CLASS_WRITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    picked[field] = body[field];
  }
  return picked;
}

/**
 * GET /api/vehicle-type-classes
 * FR-11. List classes scoped to the authenticated user's company.
 */
router.get("/", requireCapability(canReadFleetRoster), async (req: Request, res: Response) => {
  const classes = await prisma.vehicleTypeClass.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { name: "asc" },
  });
  res.json(classes);
});

/**
 * POST /api/vehicle-type-classes
 * FR-11. Body: { name, classKind, sourceMarker? }
 */
router.post("/", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const { name, classKind } = req.body;
  if (!name || !classKind) {
    return res.status(400).json({ error: "name and classKind are required" });
  }

  const fields = pickVehicleTypeClassFields(req.body);
  const vehicleTypeClass = await prisma.vehicleTypeClass.create({
    data: { companyId: req.auth!.companyId, ...fields, name, classKind },
  });
  res.status(201).json(vehicleTypeClass);
});

/**
 * PATCH /api/vehicle-type-classes/:id
 * FR-11. Body: any subset of the whitelisted fields.
 */
router.patch("/:id", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const existing = await prisma.vehicleTypeClass.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Vehicle type class not found" });
  }

  const fields = pickVehicleTypeClassFields(req.body);
  const updated = await prisma.vehicleTypeClass.update({ where: { id: existing.id }, data: fields });
  res.json(updated);
});

export default router;
