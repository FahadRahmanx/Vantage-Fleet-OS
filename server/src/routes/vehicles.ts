import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

/**
 * GET /api/vehicles
 * List vehicles scoped to the authenticated user's company.
 */
router.get("/", async (req: Request, res: Response) => {
  const vehicles = await prisma.vehicle.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { plate: "asc" },
  });
  res.json(vehicles);
});

export default router;
