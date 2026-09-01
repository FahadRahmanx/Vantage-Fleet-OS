import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

/**
 * GET /api/statuses
 * List all dispatch statuses for the authenticated user's company.
 */
router.get("/", async (req: Request, res: Response) => {
  const statuses = await prisma.dispatchStatus.findMany({
    where: { companyId: req.auth!.companyId },
    orderBy: { code: "asc" },
  });
  res.json(statuses);
});

/**
 * GET /api/transitions
 * List all dispatch transitions for the authenticated user's company.
 */
router.get("/transitions", async (req: Request, res: Response) => {
  const transitions = await prisma.dispatchTransition.findMany({
    where: { companyId: req.auth!.companyId },
    include: {
      fromStatus: { select: { id: true, code: true, name: true } },
      toStatus: { select: { id: true, code: true, name: true } },
    },
    orderBy: { fromStatus: { code: "asc" } },
  });
  res.json(transitions);
});

export default router;
