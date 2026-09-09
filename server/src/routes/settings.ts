import { Router, Request, Response } from "express";
import { requireCapability, canManageSettings } from "../middleware/permissions";
import { getAllSettings, setSetting } from "../services/settings";

const router = Router();

/**
 * GET /api/settings
 */
router.get("/", requireCapability(canManageSettings), async (req: Request, res: Response) => {
  const settings = await getAllSettings(req.auth!.companyId);
  res.json(settings);
});

/**
 * PUT /api/settings/:key
 * Body: { value: string }
 */
router.put("/:key", requireCapability(canManageSettings), async (req: Request, res: Response) => {
  const { value } = req.body;
  if (typeof value !== "string") {
    return res.status(400).json({ error: "value must be a string" });
  }

  const setting = await setSetting(req.auth!.companyId, req.params.key as string, value);
  res.json(setting);
});

export default router;
