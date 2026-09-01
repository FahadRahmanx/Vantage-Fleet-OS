import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { advance, revert, assignDriver, createLoad, updateLoad } from "../services/workflow";
import { WorkflowError, EligibilityError } from "../services/eligibility";

const router = Router();

/**
 * GET /api/loads
 * List loads scoped to the authenticated user's company (FR-3).
 */
router.get("/", async (req: Request, res: Response) => {
  const loads = await prisma.load.findMany({
    where: { companyId: req.auth!.companyId },
    include: {
      currentStatus: true,
      driver: { select: { id: true, name: true } },
      vehicle: { select: { id: true, make: true, model: true, plate: true } },
      creator: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(loads);
});

/**
 * POST /api/loads
 * Create a new load in "created" status.
 */
router.post("/", async (req: Request, res: Response) => {
  const { origin, destination } = req.body;
  if (!origin || !destination) {
    return res.status(400).json({ error: "origin and destination are required" });
  }

  try {
    const load = await createLoad(origin, destination, req.auth!.companyId, req.auth!.userId);
    res.status(201).json(load);
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(500).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * GET /api/loads/:id
 * Load detail with status history.
 */
router.get("/:id", async (req: Request, res: Response) => {
  const load = await prisma.load.findFirst({
    where: { id: req.params.id, companyId: req.auth!.companyId },
    include: {
      currentStatus: true,
      driver: true,
      vehicle: true,
      creator: { select: { id: true, name: true, email: true } },
      statusLogs: {
        include: {
          fromStatus: true,
          toStatus: true,
          actor: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!load) {
    return res.status(404).json({ error: "Load not found" });
  }

  res.json(load);
});

/**
 * PATCH /api/loads/:id
 * Body: { origin?, destination? }
 * FR-20: editable only while in the default "Created" status.
 */
router.patch("/:id", async (req: Request, res: Response) => {
  const { origin, destination } = req.body;
  if (origin === undefined && destination === undefined) {
    return res.status(400).json({ error: "origin and/or destination are required" });
  }

  try {
    const updated = await updateLoad(req.params.id, req.auth!.userId, { origin, destination });
    res.json(updated);
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * POST /api/loads/:id/assign
 * Body: { driverId, vehicleId }
 * Assigns driver + vehicle with eligibility check.
 */
router.post("/:id/assign", async (req: Request, res: Response) => {
  const { driverId, vehicleId } = req.body;
  if (!driverId || !vehicleId) {
    return res.status(400).json({ error: "driverId and vehicleId are required" });
  }

  try {
    const updated = await assignDriver(
      req.params.id,
      driverId,
      vehicleId,
      req.auth!.userId
    );
    res.json(updated);
  } catch (e) {
    if (e instanceof EligibilityError) {
      return res.status(422).json({ error: "Driver not eligible", reason: e.message });
    }
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
});

/**
 * POST /api/loads/:id/advance
 * Body: { targetStatusId }
 * Advances the load to the target status (validates transition from DB).
 */
router.post("/:id/advance", async (req: Request, res: Response) => {
  const { targetStatusId } = req.body;
  if (!targetStatusId) {
    return res.status(400).json({ error: "targetStatusId is required" });
  }

  try {
    const result = await advance(req.params.id, targetStatusId, req.auth!.userId);
    res.json(result);
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    if (e instanceof EligibilityError) {
      return res.status(422).json({ error: "Driver not eligible", reason: e.message });
    }
    throw e;
  }
});

/**
 * POST /api/loads/:id/revert
 * Body: { targetStatusId }
 * Reverts the load to a previous status (validates reverse transition from DB).
 */
router.post("/:id/revert", async (req: Request, res: Response) => {
  const { targetStatusId } = req.body;
  if (!targetStatusId) {
    return res.status(400).json({ error: "targetStatusId is required" });
  }

  try {
    const result = await revert(req.params.id, targetStatusId, req.auth!.userId);
    res.json(result);
  } catch (e) {
    if (e instanceof WorkflowError) {
      return res.status(400).json({ error: e.message });
    }
    throw e;
  }
});

export default router;
