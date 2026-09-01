import prisma from "../lib/prisma";
import { checkEligibility, WorkflowError, EligibilityError } from "./eligibility";

/**
 * advance(loadId, targetStatusId, actorId)
 *
 * Single DB transaction (PRD §6):
 *  1. Re-check role + company scope
 *  2. Validate the transition exists in the transitions table
 *  3. Run eligibility check if target status requires it (assigned)
 *  4. Update loads.current_status_id
 *  5. Insert one row into load_status_logs
 *
 * If any step fails, the whole transaction rolls back.
 */
export async function advance(loadId: string, targetStatusId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    // ── 1. Load the actor, verify role + company scope ──
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (actor.role !== "dispatcher" && actor.role !== "fleet_admin") {
      throw new WorkflowError("Actor does not have dispatch permissions");
    }

    // ── 2. Load the current state of the load ──
    const load = await tx.load.findUniqueOrThrow({
      where: { id: loadId },
      include: { currentStatus: true },
    });

    // Company scope check (FR-3)
    if (load.companyId !== actor.companyId) {
      throw new WorkflowError("Load does not belong to actor's company");
    }

    // ── 3. Validate the transition exists ──
    const transition = await tx.dispatchTransition.findUnique({
      where: {
        companyId_fromStatusId_toStatusId: {
          companyId: actor.companyId,
          fromStatusId: load.currentStatusId,
          toStatusId: targetStatusId,
        },
      },
    });

    if (!transition) {
      throw new WorkflowError(
        `No transition allowed from "${load.currentStatus.code}" to the target status`
      );
    }

    // ── 4. Eligibility check if assigning (target = "assigned") ──
    const targetStatus = await tx.dispatchStatus.findUniqueOrThrow({
      where: { id: targetStatusId },
    });

    if (targetStatus.code === "assigned") {
      if (!load.driverId) {
        throw new WorkflowError("Cannot advance to Assigned without a driver set on the load");
      }
      const eligibility = await checkEligibility(load.driverId);
      if (!eligibility.eligible) {
        throw new EligibilityError(eligibility.reason!);
      }
    }

    // ── 5. Update load status ──
    await tx.load.update({
      where: { id: loadId },
      data: { currentStatusId: targetStatusId },
    });

    // ── 6. Insert immutable audit log row ──
    const log = await tx.loadStatusLog.create({
      data: {
        loadId,
        fromStatusId: load.currentStatusId,
        toStatusId: targetStatusId,
        actorId,
      },
    });

    return { load: { id: loadId, currentStatusId: targetStatusId }, log };
  });
}

/**
 * revert(loadId, targetStatusId, actorId)
 *
 * Same transaction shape as advance, but validates the REVERSE transition exists.
 * Used for moving a load backward in the workflow.
 */
export async function revert(loadId: string, targetStatusId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    // ── 1. Load the actor, verify role + company scope ──
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (actor.role !== "dispatcher" && actor.role !== "fleet_admin") {
      throw new WorkflowError("Actor does not have dispatch permissions");
    }

    // ── 2. Load the current state of the load ──
    const load = await tx.load.findUniqueOrThrow({
      where: { id: loadId },
      include: { currentStatus: true },
    });

    // Company scope check (FR-3)
    if (load.companyId !== actor.companyId) {
      throw new WorkflowError("Load does not belong to actor's company");
    }

    // ── 3. Validate the REVERSE transition exists ──
    const transition = await tx.dispatchTransition.findUnique({
      where: {
        companyId_fromStatusId_toStatusId: {
          companyId: actor.companyId,
          fromStatusId: load.currentStatusId,
          toStatusId: targetStatusId,
        },
      },
    });

    if (!transition) {
      throw new WorkflowError(
        `No transition allowed from "${load.currentStatus.code}" back to the target status`
      );
    }

    // ── 4. Update load status ──
    await tx.load.update({
      where: { id: loadId },
      data: { currentStatusId: targetStatusId },
    });

    // ── 5. Insert immutable audit log row ──
    const log = await tx.loadStatusLog.create({
      data: {
        loadId,
        fromStatusId: load.currentStatusId,
        toStatusId: targetStatusId,
        actorId,
      },
    });

    return { load: { id: loadId, currentStatusId: targetStatusId }, log };
  });
}

/**
 * assignDriver(loadId, driverId, vehicleId, actorId)
 *
 * Assigns a driver and vehicle to a load, running the eligibility check.
 * Does NOT advance the status — that's a separate action.
 */
export async function assignDriver(
  loadId: string,
  driverId: string,
  vehicleId: string,
  actorId: string
) {
  // ── 1. Load the actor, verify role + company scope ──
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
  if (actor.role !== "dispatcher" && actor.role !== "fleet_admin") {
    throw new WorkflowError("Actor does not have dispatch permissions");
  }

  // ── 2. Load the current state of the load ──
  const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
  if (load.companyId !== actor.companyId) {
    throw new WorkflowError("Load does not belong to actor's company");
  }

  // ── 3. Eligibility check ──
  const eligibility = await checkEligibility(driverId);
  if (!eligibility.eligible) {
    throw new EligibilityError(eligibility.reason!);
  }

  // ── 4. Verify driver and vehicle belong to the same company ──
  const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
  if (driver.companyId !== actor.companyId) {
    throw new WorkflowError("Driver does not belong to actor's company");
  }

  const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  if (vehicle.companyId !== actor.companyId) {
    throw new WorkflowError("Vehicle does not belong to actor's company");
  }

  // ── 5. Update the load ──
  const updated = await prisma.load.update({
    where: { id: loadId },
    data: { driverId, vehicleId },
  });

  return updated;
}
