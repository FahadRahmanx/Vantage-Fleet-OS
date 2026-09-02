import { Router, Request, Response } from "express";
import { getComplianceQueue, finalizeCompliance } from "../services/compliance";
import { requireCapability, canComplianceWrite } from "../middleware/permissions";
import { WorkflowError } from "../services/eligibility";

const router = Router();

/**
 * GET /api/compliance/queue
 * Routes awaiting compliance review (FR-41).
 */
router.get("/queue", async (req: Request, res: Response) => {
  const routes = await getComplianceQueue(req.auth!.companyId);
  res.json(routes);
});

/**
 * POST /api/compliance/:routeId/finalize
 * FR-42: tallies outcomes + HOS hours, writes a ComplianceRecord, routes
 * any out-of-service load back to maintenance.
 */
router.post("/:routeId/finalize", requireCapability(canComplianceWrite), async (req: Request, res: Response) => {
  try {
    const result = await finalizeCompliance(req.params.routeId as string, req.auth!.userId);
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
});

export default router;
