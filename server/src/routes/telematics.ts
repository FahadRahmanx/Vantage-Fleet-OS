import { Router, Request, Response } from "express";
import { authenticateTelematics } from "../middleware/telematics-auth";
import { normalizeTelematicsPayload, ingestTelematics } from "../services/telematics";
import { WorkflowError } from "../services/eligibility";

const router = Router();

/**
 * POST /api/telematics/ingest
 * Body: { vin, mileage, engineHours, timestamp?, location? }
 * Auth: per-company bearer token (authenticateTelematics), not the user JWT.
 * FR-47/48, mocked — no real vendor call, matches vehicle by VIN.
 */
router.post("/ingest", authenticateTelematics, async (req: Request, res: Response) => {
  try {
    const payload = normalizeTelematicsPayload(req.body);
    const vehicle = await ingestTelematics(req.telematicsCompanyId!, payload);
    res.json(vehicle);
  } catch (e) {
    if (e instanceof WorkflowError) {
      const status = e.message.startsWith("No vehicle") ? 404 : 400;
      return res.status(status).json({ error: e.message });
    }
    throw e;
  }
});

export default router;
