import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canManageFleetRoster } from "../middleware/permissions";

const router = Router();

const DEFECT_CATEGORY_WRITABLE_FIELDS = [
  "name", "outcome", "requiresTechnicianNote", "active", "excludedVehicleTypes",
] as const;

function pickDefectCategoryFields(body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const field of DEFECT_CATEGORY_WRITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    picked[field] = body[field];
  }
  return picked;
}

/**
 * GET /api/defect-categories
 * GET /api/defect-categories?vehicleId=
 * Read-only reference data for the DVIR form's defect checklist. With
 * vehicleId, excludes any category whose excludedVehicleTypes includes
 * that vehicle's type (FR-13/14). Without it, behavior is unchanged.
 */
router.get("/", async (req: Request, res: Response) => {
  const categories = await prisma.defectCategory.findMany({
    where: { companyId: req.auth!.companyId, active: true },
    orderBy: { name: "asc" },
  });

  const vehicleId = typeof req.query.vehicleId === "string" ? req.query.vehicleId : undefined;
  if (!vehicleId) {
    return res.json(categories);
  }

  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, companyId: req.auth!.companyId } });
  if (!vehicle) {
    return res.status(404).json({ error: "Vehicle not found" });
  }

  const filtered = categories.filter((c) => !c.excludedVehicleTypes.includes(vehicle.type));
  res.json(filtered);
});

/**
 * POST /api/defect-categories
 * FR-13/14. Body: { name, outcome, requiresTechnicianNote?, excludedVehicleTypes? }
 */
router.post("/", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const { name, outcome } = req.body;
  if (!name || !outcome) {
    return res.status(400).json({ error: "name and outcome are required" });
  }

  const fields = pickDefectCategoryFields(req.body);
  try {
    const category = await prisma.defectCategory.create({
      data: { companyId: req.auth!.companyId, ...fields, name, outcome },
    });
    res.status(201).json(category);
  } catch (e: any) {
    if (e?.code === "P2002") {
      return res.status(409).json({ error: "A defect category with this name already exists" });
    }
    throw e;
  }
});

/**
 * PATCH /api/defect-categories/:id
 * FR-13/14. Body: any subset of the whitelisted fields.
 */
router.patch("/:id", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const existing = await prisma.defectCategory.findFirst({
    where: { id: req.params.id as string, companyId: req.auth!.companyId },
  });
  if (!existing) {
    return res.status(404).json({ error: "Defect category not found" });
  }

  const fields = pickDefectCategoryFields(req.body);
  try {
    const updated = await prisma.defectCategory.update({ where: { id: existing.id }, data: fields });
    res.json(updated);
  } catch (e: any) {
    if (e?.code === "P2002") {
      return res.status(409).json({ error: "A defect category with this name already exists" });
    }
    throw e;
  }
});

export default router;
