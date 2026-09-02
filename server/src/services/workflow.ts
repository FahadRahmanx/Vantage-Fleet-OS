import { Prisma } from "@prisma/client";
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
export interface AdvancePayload {
  comment?: string;
  stopCount?: number;
}

export async function advance(
  loadId: string,
  targetStatusId: string | undefined,
  actorId: string,
  payload?: AdvancePayload
) {
  return prisma.$transaction(async (tx) => {
    // ── 1. Load the actor ──
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });

    // ── 2. Load the current state of the load ──
    const load = await tx.load.findUniqueOrThrow({
      where: { id: loadId },
      include: { currentStatus: true },
    });

    // Company scope check (FR-3)
    if (load.companyId !== actor.companyId) {
      throw new WorkflowError("Load does not belong to actor's company");
    }

    // ── 3. Role check — data-driven (FR-23): the current status's
    // roleVisibility decides who may advance out of it. platformAdmin
    // always bypasses.
    if (!actor.platformAdmin && !load.currentStatus.roleVisibility.includes(actor.role)) {
      throw new WorkflowError("Actor does not have dispatch permissions");
    }

    // ── 4. Resolve targetStatusId if the caller didn't supply one (FR-24) ──
    let resolvedTargetStatusId = targetStatusId;
    if (!resolvedTargetStatusId) {
      const defaultTransition = await tx.dispatchTransition.findFirst({
        where: { companyId: actor.companyId, fromStatusId: load.currentStatusId, isDefaultTarget: true },
      });
      if (!defaultTransition) {
        throw new WorkflowError("No target status resolved and no default transition configured");
      }
      resolvedTargetStatusId = defaultTransition.toStatusId;
    }

    // ── 5. Validate the transition exists ──
    const transition = await tx.dispatchTransition.findUnique({
      where: {
        companyId_fromStatusId_toStatusId: {
          companyId: actor.companyId,
          fromStatusId: load.currentStatusId,
          toStatusId: resolvedTargetStatusId,
        },
      },
    });

    if (!transition) {
      throw new WorkflowError(
        `No transition allowed from "${load.currentStatus.code}" to the target status`
      );
    }

    // ── 6. Enforce direction (FR-23/31): advance only moves same-rank-or-forward.
    // A backward-ranked target must go through revert() instead, even if a
    // transition row happens to exist between them. This check is
    // unconditional — outcome-routing (a later phase) only picks which
    // forward transition to take; it never bypasses this invariant.
    const targetStatus = await tx.dispatchStatus.findUniqueOrThrow({
      where: { id: resolvedTargetStatusId },
    });

    if (targetStatus.position < load.currentStatus.position) {
      throw new WorkflowError(
        `"${targetStatus.code}" is behind "${load.currentStatus.code}" — use revert(), not advance()`
      );
    }

    // ── 7. Eligibility check if the target status requires it (FR-22/26).
    // Captures a before/after snapshot (FR-35) — "before" recomputes what
    // eligibility looked like at assignment time rather than requiring a
    // separately-persisted row (same "recompute, don't duplicate-store"
    // pattern as the position-based direction check).
    let eligibilitySnapshot: { before: unknown; after: unknown } | undefined;
    if (targetStatus.requiresEligibilityCheck) {
      if (!load.driverId) {
        throw new WorkflowError("Cannot advance to Assigned without a driver set on the load");
      }
      const before = await checkEligibility(load.driverId, load.vehicleId ?? undefined, load.driverAssignedAt ?? undefined);
      const after = await checkEligibility(load.driverId, load.vehicleId ?? undefined);
      eligibilitySnapshot = { before, after };
      if (!after.eligible) {
        throw new EligibilityError(after.reason!);
      }
    }

    // ── 8. Update load status ──
    await tx.load.update({
      where: { id: loadId },
      data: { currentStatusId: resolvedTargetStatusId },
    });

    // ── 9. Insert immutable audit log row ──
    const log = await tx.loadStatusLog.create({
      data: {
        loadId,
        fromStatusId: load.currentStatusId,
        toStatusId: resolvedTargetStatusId,
        actorId,
        reverted: false,
        comment: payload?.comment,
        stopCount: payload?.stopCount,
        // Prisma's Json input type doesn't accept `unknown` fields directly;
        // eligibilitySnapshot is a plain serializable EligibilityResult pair
        // at the JSON-storage boundary, so a cast here is the right tool.
        capturedData: eligibilitySnapshot ? ({ version: 1, eligibility: eligibilitySnapshot } as Prisma.InputJsonValue) : undefined,
      },
    });

    return { load: { id: loadId, currentStatusId: resolvedTargetStatusId }, log };
  }, { timeout: 30000 }); // eligibility's before/after snapshot (Phase 2) adds real DB round-trips inside this transaction — the default 5s interactive-transaction timeout isn't enough headroom against the project's observed remote-DB latency (seen ranging 5-25s against this Supabase instance).
}

/**
 * revert(loadId, targetStatusId, actorId)
 *
 * Same transaction shape as advance, but requires the target status to
 * actually be behind the current one (FR-31) — a transition row existing
 * between two statuses isn't enough on its own, since the same row could
 * legitimately be walked forward by advance().
 */
export async function revert(
  loadId: string,
  targetStatusId: string,
  actorId: string,
  payload?: { comment?: string }
) {
  return prisma.$transaction(async (tx) => {
    // ── 1. Load the actor ──
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });

    // ── 2. Load the current state of the load ──
    const load = await tx.load.findUniqueOrThrow({
      where: { id: loadId },
      include: { currentStatus: true },
    });

    // Company scope check (FR-3)
    if (load.companyId !== actor.companyId) {
      throw new WorkflowError("Load does not belong to actor's company");
    }

    // ── 3. Role check — data-driven (FR-23), same rule as advance() ──
    if (!actor.platformAdmin && !load.currentStatus.roleVisibility.includes(actor.role)) {
      throw new WorkflowError("Actor does not have dispatch permissions");
    }

    // ── 4. Validate the REVERSE transition exists ──
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

    // ── 5. Enforce direction (FR-31): revert is backward-only — the target
    // must rank strictly earlier than the current status, not just have a
    // transition row pointing at it.
    const targetStatus = await tx.dispatchStatus.findUniqueOrThrow({
      where: { id: targetStatusId },
    });

    if (targetStatus.position >= load.currentStatus.position) {
      throw new WorkflowError(
        `"${targetStatus.code}" is not behind "${load.currentStatus.code}" — use advance(), not revert()`
      );
    }

    // ── 6. Update load status ──
    await tx.load.update({
      where: { id: loadId },
      data: { currentStatusId: targetStatusId },
    });

    // ── 7. Insert immutable audit log row ──
    const log = await tx.loadStatusLog.create({
      data: {
        loadId,
        fromStatusId: load.currentStatusId,
        toStatusId: targetStatusId,
        actorId,
        reverted: true,
        comment: payload?.comment,
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
  if (!actor.platformAdmin && actor.role !== "dispatcher" && actor.role !== "fleet_admin") {
    throw new WorkflowError("Actor does not have dispatch permissions");
  }

  // ── 2. Load the current state of the load ──
  const load = await prisma.load.findUniqueOrThrow({ where: { id: loadId } });
  if (load.companyId !== actor.companyId) {
    throw new WorkflowError("Load does not belong to actor's company");
  }

  // ── 3. Eligibility check ──
  const eligibility = await checkEligibility(driverId, vehicleId);
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
    data: { driverId, vehicleId, driverAssignedAt: new Date() },
  });

  return updated;
}

/**
 * createLoad(origin, destination, companyId, creatorId)
 *
 * Creates a load in the company's default "created" status, with a
 * human-readable reference (FR-17: VFO + zero-padded 7-digit sequence).
 */
export async function createLoad(
  origin: string,
  destination: string,
  companyId: string,
  creatorId: string
) {
  const createdStatus = await prisma.dispatchStatus.findFirst({
    where: { companyId, isDefault: true },
  });
  if (!createdStatus) {
    throw new WorkflowError("No default status found for this company");
  }

  // Counting existing loads is race-prone under concurrent creates; the POC
  // has no concurrent-write scenario to guard against, so this is acceptable
  // for scope rather than a production-grade sequence.
  const count = await prisma.load.count();
  const reference = `VFO${String(count + 1).padStart(7, "0")}`;

  return prisma.load.create({
    data: {
      reference,
      origin,
      destination,
      companyId,
      creatorId,
      currentStatusId: createdStatus.id,
    },
    include: { currentStatus: true },
  });
}

/**
 * updateLoad(loadId, actorId, data)
 *
 * FR-20: a load is editable only while in the default "created" status —
 * once advanced, it may only move via advance()/revert().
 */
export async function updateLoad(
  loadId: string,
  actorId: string,
  data: { origin?: string; destination?: string }
) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });
  if (!actor.platformAdmin && actor.role !== "dispatcher" && actor.role !== "fleet_admin") {
    throw new WorkflowError("Actor does not have dispatch permissions");
  }

  const load = await prisma.load.findUniqueOrThrow({
    where: { id: loadId },
    include: { currentStatus: true },
  });
  if (load.companyId !== actor.companyId) {
    throw new WorkflowError("Load does not belong to actor's company");
  }

  if (!load.currentStatus.isDefault) {
    throw new WorkflowError(
      `Load cannot be edited once advanced past Created (current status: "${load.currentStatus.code}")`
    );
  }

  return prisma.load.update({
    where: { id: loadId },
    data,
    include: { currentStatus: true },
  });
}
