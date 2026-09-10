import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canReadFleetRoster } from "../middleware/permissions";

const router = Router();

/**
 * GET /api/hos-rulesets
 * Reference data for the Driver admin form's ruleset dropdown (FR-10).
 * No CRUD here — HosRuleset management itself is out of scope for this
 * round (spec §9), this is read-only support for the Driver form.
 */
router.get("/", requireCapability(canReadFleetRoster), async (req: Request, res: Response) => {
  const rulesets = await prisma.hosRuleset.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { name: "asc" },
  });
  res.json(rulesets);
});

export default router;
