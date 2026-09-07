import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { requireCapability, canManageUsers } from "../middleware/permissions";

const router = Router();

/**
 * GET /api/carrier-companies
 * Reference data for the invite form's carrier dropdown (FR-6).
 */
router.get("/", requireCapability(canManageUsers), async (req: Request, res: Response) => {
  const carriers = await prisma.carrierCompany.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { name: "asc" },
  });
  res.json(carriers);
});

export default router;
