import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canReadFleetRoster, canManageFleetRoster } from "../middleware/permissions";

const router = Router();

const TEMPLATE_WRITABLE_FIELDS = ["taskName", "basis", "intervalValue", "appliesToggle"] as const;

function pickTemplateFields(body: Record<string, unknown>) {
  const picked: Record<string, unknown> = {};
  for (const field of TEMPLATE_WRITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    picked[field] = body[field];
  }
  return picked;
}

async function findClassInCompany(vehicleTypeClassId: string, companyId: string) {
  return prisma.vehicleTypeClass.findFirst({ where: { id: vehicleTypeClassId, companyId } });
}

/**
 * GET /api/maintenance-interval-templates?vehicleTypeClassId=
 * FR-12. Required query param — templates are always listed per class.
 */
router.get("/", requireCapability(canReadFleetRoster), async (req: Request, res: Response) => {
  const vehicleTypeClassId = typeof req.query.vehicleTypeClassId === "string" ? req.query.vehicleTypeClassId : undefined;
  if (!vehicleTypeClassId) {
    return res.status(400).json({ error: "vehicleTypeClassId is required" });
  }

  const vehicleTypeClass = await findClassInCompany(vehicleTypeClassId, req.auth!.companyId);
  if (!vehicleTypeClass) {
    return res.status(404).json({ error: "Vehicle type class not found" });
  }

  const templates = await prisma.maintenanceIntervalTemplate.findMany({
    where: { vehicleTypeClassId },
    orderBy: { taskName: "asc" },
  });
  res.json(templates);
});

/**
 * POST /api/maintenance-interval-templates
 * FR-12. Body: { vehicleTypeClassId, taskName, basis, intervalValue, appliesToggle? }
 */
router.post("/", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const { vehicleTypeClassId, taskName, basis, intervalValue } = req.body;
  if (!vehicleTypeClassId || !taskName || !basis || intervalValue === undefined) {
    return res.status(400).json({ error: "vehicleTypeClassId, taskName, basis, and intervalValue are required" });
  }

  const vehicleTypeClass = await findClassInCompany(vehicleTypeClassId, req.auth!.companyId);
  if (!vehicleTypeClass) {
    return res.status(404).json({ error: "Vehicle type class not found" });
  }

  const fields = pickTemplateFields(req.body);
  const template = await prisma.maintenanceIntervalTemplate.create({
    data: { vehicleTypeClassId, ...fields, taskName, basis, intervalValue },
  });
  res.status(201).json(template);
});

/**
 * PATCH /api/maintenance-interval-templates/:id
 * FR-12. Body: any subset of the whitelisted fields.
 */
router.patch("/:id", requireCapability(canManageFleetRoster), async (req: Request, res: Response) => {
  const existing = await prisma.maintenanceIntervalTemplate.findUnique({
    where: { id: req.params.id as string },
    include: { vehicleTypeClass: true },
  });
  if (!existing || existing.vehicleTypeClass.companyId !== req.auth!.companyId) {
    return res.status(404).json({ error: "Maintenance interval template not found" });
  }

  const fields = pickTemplateFields(req.body);
  const updated = await prisma.maintenanceIntervalTemplate.update({ where: { id: existing.id }, data: fields });
  res.json(updated);
});

export default router;
