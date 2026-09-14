import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability } from "../middleware/permissions";

const router = Router();

function platformAdminOnly(auth: { platformAdmin: boolean }): boolean {
  return auth.platformAdmin;
}

function requireConfirm(req: Request, res: Response, phrase: string): boolean {
  if (req.body?.confirm !== phrase) {
    res.status(400).json({ error: `Body must include { "confirm": "${phrase}" }` });
    return false;
  }
  return true;
}

/**
 * POST /api/dev-tools/clear-loads
 * FR-57. Dev/staging only (route is unmounted entirely in production —
 * see index.ts). Deletes all loads and their status logs for the actor's
 * company. Typed confirmation is a misclick guard, not a security boundary.
 */
router.post("/clear-loads", requireCapability(platformAdminOnly), async (req: Request, res: Response) => {
  if (!requireConfirm(req, res, "DELETE LOADS")) return;

  const companyId = req.auth!.companyId;
  const loadIds = (await prisma.load.findMany({ where: { companyId }, select: { id: true } })).map((l) => l.id);
  await prisma.loadStatusLog.deleteMany({ where: { loadId: { in: loadIds } } });
  const result = await prisma.load.deleteMany({ where: { companyId } });
  res.json({ deletedLoads: result.count });
});

/**
 * POST /api/dev-tools/clear-routes
 * FR-57. Deletes ComplianceRecord and RouteStop rows tied to this
 * company's routes, then the routes themselves. Loads are untouched.
 */
router.post("/clear-routes", requireCapability(platformAdminOnly), async (req: Request, res: Response) => {
  if (!requireConfirm(req, res, "DELETE ROUTES")) return;

  const companyId = req.auth!.companyId;
  const routeIds = (await prisma.route.findMany({ where: { companyId }, select: { id: true } })).map((r) => r.id);
  await prisma.complianceRecord.deleteMany({ where: { routeId: { in: routeIds } } });
  await prisma.routeStop.deleteMany({ where: { routeId: { in: routeIds } } });
  const result = await prisma.route.deleteMany({ where: { companyId } });
  res.json({ deletedRoutes: result.count });
});

/**
 * POST /api/dev-tools/clear-uploads
 * FR-57. Deletes UploadRow rows then Upload rows for this company.
 */
router.post("/clear-uploads", requireCapability(platformAdminOnly), async (req: Request, res: Response) => {
  if (!requireConfirm(req, res, "DELETE UPLOADS")) return;

  const companyId = req.auth!.companyId;
  const uploadIds = (await prisma.upload.findMany({ where: { companyId }, select: { id: true } })).map((u) => u.id);
  await prisma.uploadRow.deleteMany({ where: { uploadId: { in: uploadIds } } });
  const result = await prisma.upload.deleteMany({ where: { companyId } });
  res.json({ deletedUploads: result.count });
});

export default router;
