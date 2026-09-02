import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canDispatchWrite } from "../middleware/permissions";
import { createRoute } from "../services/routes";
import { WorkflowError } from "../services/eligibility";

const router = Router();

/**
 * GET /api/routes
 * Company-scoped list, most recent first.
 */
router.get("/", async (req: Request, res: Response) => {
  const routes = await prisma.route.findMany({
    where: { companyId: req.auth!.companyId },
    include: { stops: { include: { load: { include: { currentStatus: true } } }, orderBy: { sequence: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(routes);
});

/**
 * POST /api/routes
 * Body: { loadIds: string[] }
 * FR-38: create a route, auto-advancing any already-eligible attached load.
 */
router.post("/", requireCapability(canDispatchWrite), async (req: Request, res: Response) => {
  const { loadIds } = req.body;
  if (!Array.isArray(loadIds) || loadIds.length === 0) {
    return res.status(400).json({ error: "loadIds (non-empty array) is required" });
  }

  try {
    const result = await createRoute(req.auth!.companyId, req.auth!.userId, loadIds);
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
});

export default router;
