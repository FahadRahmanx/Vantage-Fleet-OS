import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

/**
 * GET /api/drivers
 * List drivers scoped to the authenticated user's company.
 */
router.get("/", async (req: Request, res: Response) => {
  const drivers = await prisma.driver.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { name: "asc" },
  });
  res.json(drivers);
});

export default router;
