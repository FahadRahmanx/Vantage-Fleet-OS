import { Router, Request, Response } from "express";
import prisma from "../lib/prisma";
import { computeHosAvailability } from "../services/hos";

const router = Router();

/**
 * GET /api/duty-status?driverId=
 * List a driver's duty-status entries, most recent first.
 */
router.get("/", async (req: Request, res: Response) => {
  const { driverId } = req.query;
  if (!driverId || typeof driverId !== "string") {
    return res.status(400).json({ error: "driverId query parameter is required" });
  }

  const driver = await prisma.driver.findFirst({ where: { id: driverId, companyId: req.auth!.companyId } });
  if (!driver) {
    return res.status(404).json({ error: "Driver not found" });
  }

  const entries = await prisma.dutyStatusEntry.findMany({
    where: { driverId },
    orderBy: { startedAt: "desc" },
  });
  res.json(entries);
});

/**
 * POST /api/duty-status
 * Body: { driverId, dutyStatus, startedAt, endedAt?, loadId?, onDutyOverride? }
 * FR-40: log a duty-status change.
 */
router.post("/", async (req: Request, res: Response) => {
  const { driverId, dutyStatus, startedAt, endedAt, loadId, onDutyOverride } = req.body;
  if (!driverId || !dutyStatus || !startedAt) {
    return res.status(400).json({ error: "driverId, dutyStatus, and startedAt are required" });
  }

  const driver = await prisma.driver.findFirst({ where: { id: driverId, companyId: req.auth!.companyId } });
  if (!driver) {
    return res.status(404).json({ error: "Driver not found" });
  }

  const entry = await prisma.dutyStatusEntry.create({
    data: {
      driverId,
      companyId: req.auth!.companyId,
      dutyStatus,
      startedAt: new Date(startedAt),
      endedAt: endedAt ? new Date(endedAt) : undefined,
      loadId,
      onDutyOverride,
    },
  });
  res.status(201).json(entry);
});

/**
 * GET /api/duty-status/:driverId/availability
 * Thin wrapper over computeHosAvailability — the live number the
 * assignment form's eligibility panel polls.
 */
router.get("/:driverId/availability", async (req: Request, res: Response) => {
  const driver = await prisma.driver.findFirst({ where: { id: req.params.driverId as string, companyId: req.auth!.companyId } });
  if (!driver) {
    return res.status(404).json({ error: "Driver not found" });
  }
  if (!driver.hosRulesetId) {
    return res.status(400).json({ error: "Driver has no HOS ruleset assigned" });
  }

  const snapshot = await computeHosAvailability(driver.id, driver.hosRulesetId);
  res.json(snapshot);
});

export default router;
