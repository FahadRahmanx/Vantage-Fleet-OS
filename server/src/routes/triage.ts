import { Router, Request, Response } from "express";
import { requireCapability, canTriageFaults, canComplianceWrite } from "../middleware/permissions";
import { WorkflowError } from "../services/eligibility";
import {
  getVehicleTriageSummaries,
  getVehicleFaults,
  confirmFault,
  confirmAllInRepair,
  overrideFaultStatus,
  setOutOfServiceOverride,
} from "../services/triage";

const router = Router();

function handleWorkflowError(e: unknown, res: Response) {
  if (e instanceof WorkflowError) {
    const status = e.message.includes("not found") ? 404 : 400;
    return res.status(status).json({ error: e.message });
  }
  throw e;
}

router.get("/vehicles", requireCapability(canTriageFaults), async (req: Request, res: Response) => {
  const summaries = await getVehicleTriageSummaries(req.auth!.companyId);
  res.json(summaries);
});

router.get("/vehicles/:id/faults", requireCapability(canTriageFaults), async (req: Request, res: Response) => {
  try {
    const result = await getVehicleFaults(req.params.id as string, req.auth!.companyId);
    res.json(result);
  } catch (e) {
    handleWorkflowError(e, res);
  }
});

router.post("/faults/:id/confirm", requireCapability(canTriageFaults), async (req: Request, res: Response) => {
  try {
    const updated = await confirmFault(req.params.id as string, req.auth!.companyId);
    res.json(updated);
  } catch (e) {
    handleWorkflowError(e, res);
  }
});

router.post("/vehicles/:id/confirm-all", requireCapability(canTriageFaults), async (req: Request, res: Response) => {
  try {
    await confirmAllInRepair(req.params.id as string, req.auth!.companyId);
    res.json({ ok: true });
  } catch (e) {
    handleWorkflowError(e, res);
  }
});

router.patch("/faults/:id/override-status", requireCapability(canComplianceWrite), async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: "status is required" });
  }
  try {
    const updated = await overrideFaultStatus(req.params.id as string, req.auth!.companyId, status);
    res.json(updated);
  } catch (e) {
    handleWorkflowError(e, res);
  }
});

router.patch("/faults/:id/out-of-service", requireCapability(canTriageFaults), async (req: Request, res: Response) => {
  const { value } = req.body;
  if (typeof value !== "boolean") {
    return res.status(400).json({ error: "value must be a boolean" });
  }
  try {
    const updated = await setOutOfServiceOverride(req.params.id as string, req.auth!.companyId, value);
    res.json(updated);
  } catch (e) {
    handleWorkflowError(e, res);
  }
});

export default router;
