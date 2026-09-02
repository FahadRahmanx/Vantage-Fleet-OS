import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";

const router = Router();

/**
 * GET /api/audit
 * FR-35: standalone, company-wide browsable audit log — distinct from Load
 * Detail's embedded per-load trail. Row-scoped for driver (own loads only),
 * same pattern as scopeLoadsForActor for GET /api/loads.
 */
router.get("/", async (req: Request, res: Response) => {
  const auth = req.auth!;
  const loadWhere =
    auth.role === "driver" && !auth.platformAdmin
      ? { companyId: auth.companyId, driverId: auth.driverId ?? "__none__" }
      : { companyId: auth.companyId };

  const logs = await prisma.loadStatusLog.findMany({
    where: { load: loadWhere },
    include: {
      load: { select: { id: true, reference: true } },
      fromStatus: true,
      toStatus: true,
      actor: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(logs);
});

export default router;
