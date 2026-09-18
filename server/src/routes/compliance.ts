import { Router, Request, Response } from "express";
import { getComplianceQueue, finalizeCompliance } from "../services/compliance";
import { getComplianceSummaryData, renderInternalSummary, renderExternalAuditSummary, getFinalizedRoutes } from "../services/compliance-summary";
import { getSetting } from "../services/settings";
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
 * GET /api/compliance/finalized
 * FR-43. Companion to /queue — lists routes that already have a
 * ComplianceRecord, since /queue only shows unfinalized ones.
 */
router.get("/finalized", requireCapability(canComplianceWrite), async (req: Request, res: Response) => {
  const routes = await getFinalizedRoutes(req.auth!.companyId);
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

const DEFAULT_COMPLIANCE_TEMPLATE = {
  intro: "Compliance summary for route {{routeReference}}, finalized {{finalizedAt}} by {{reviewedByName}}.",
  closing: "End of summary.",
};

async function generateSummaryText(routeId: string, companyId: string, type: string) {
  const data = await getComplianceSummaryData(routeId, companyId);
  if (type === "external") {
    return renderExternalAuditSummary(data);
  }
  const raw = await getSetting(companyId, "compliance_summary_template", JSON.stringify(DEFAULT_COMPLIANCE_TEMPLATE));
  const template = JSON.parse(raw);
  return renderInternalSummary(data, template);
}

/**
 * GET /api/compliance/:routeId/summary?type=internal|external
 * FR-43. Returns the generated text for copy/paste.
 */
router.get("/:routeId/summary", requireCapability(canComplianceWrite), async (req: Request, res: Response) => {
  const type = req.query.type === "external" ? "external" : "internal";
  try {
    const text = await generateSummaryText(req.params.routeId as string, req.auth!.companyId, type);
    res.json({ text });
  } catch (e) {
    if (e instanceof WorkflowError) {
      const status = e.message.includes("not found") ? 404 : 400;
      return res.status(status).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * GET /api/compliance/:routeId/summary/export?type=internal|external
 * FR-43. Same content, delivered as a downloadable .txt file.
 */
router.get("/:routeId/summary/export", requireCapability(canComplianceWrite), async (req: Request, res: Response) => {
  const type = req.query.type === "external" ? "external" : "internal";
  try {
    const text = await generateSummaryText(req.params.routeId as string, req.auth!.companyId, type);
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename="compliance-summary-${type}-${req.params.routeId}.txt"`);
    res.send(text);
  } catch (e) {
    if (e instanceof WorkflowError) {
      const status = e.message.includes("not found") ? 404 : 400;
      return res.status(status).json({ error: e.message });
    }
    throw e;
  }
});

export default router;
