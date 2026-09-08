import { Router, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { WorkflowError } from "../services/eligibility";
import { canManageDashboards } from "../middleware/permissions";
import { getDashboards, getRoleDashboard, updateDashboard, getDashboardData } from "../services/dashboards";

const router = Router();

function handleDashboardError(e: unknown, res: Response) {
  if (e instanceof WorkflowError) {
    const status = e.message.includes("not found")
      ? 404
      : e.message.includes("Not authorized")
      ? 403
      : 400;
    return res.status(status).json({ error: e.message });
  }
  throw e;
}

/**
 * GET /api/dashboards
 * GET /api/dashboards?role=<role>  (canManageDashboards only — the
 * admin role-picker override described in spec §6)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    if (typeof req.query.role === "string") {
      if (!canManageDashboards(req.auth!)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }
      const role = await getRoleDashboard(req.auth!.companyId, req.query.role as UserRole);
      return res.json({ role });
    }
    const dashboards = await getDashboards(req.auth!);
    res.json(dashboards);
  } catch (e) {
    handleDashboardError(e, res);
  }
});

/**
 * PATCH /api/dashboards/:id
 * Body: { widgetKeys: string[] }
 */
router.patch("/:id", async (req: Request, res: Response) => {
  const { widgetKeys } = req.body;
  if (!Array.isArray(widgetKeys)) {
    return res.status(400).json({ error: "widgetKeys must be an array" });
  }

  try {
    const updated = await updateDashboard(req.params.id as string, widgetKeys, req.auth!, canManageDashboards(req.auth!));
    res.json(updated);
  } catch (e) {
    handleDashboardError(e, res);
  }
});

/**
 * GET /api/dashboards/:id/data
 */
router.get("/:id/data", async (req: Request, res: Response) => {
  try {
    const data = await getDashboardData(req.params.id as string, req.auth!, canManageDashboards(req.auth!));
    res.json(data);
  } catch (e) {
    handleDashboardError(e, res);
  }
});

export default router;
