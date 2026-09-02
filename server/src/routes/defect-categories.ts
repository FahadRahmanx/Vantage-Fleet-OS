import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

/**
 * GET /api/defect-categories
 * Read-only reference data for the DVIR form's defect checklist.
 */
router.get("/", async (req: Request, res: Response) => {
  const categories = await prisma.defectCategory.findMany({
    where: { companyId: req.auth!.companyId, active: true },
    orderBy: { name: "asc" },
  });
  res.json(categories);
});

export default router;
