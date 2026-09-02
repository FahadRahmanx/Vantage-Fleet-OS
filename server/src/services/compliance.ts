import prisma from "../lib/prisma";
import { revert } from "./workflow";
import { WorkflowError } from "./eligibility";

/**
 * getComplianceQueue(companyId)
 *
 * Routes with at least one load sitting in a compliance-review-queue
 * status (Delivered, per seed data — resolved by the flag, not the code)
 * that haven't been finalized yet.
 */
export async function getComplianceQueue(companyId: string) {
  return prisma.route.findMany({
    where: {
      companyId,
      complianceRecord: null,
      stops: { some: { load: { currentStatus: { isComplianceReviewQueue: true } } } },
    },
    include: { stops: { include: { load: { include: { currentStatus: true } } }, orderBy: { sequence: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * finalizeCompliance(routeId, actorId)
 *
 * FR-41/42: tallies each attached load's most recent inspection outcome
 * (override, if set, wins) and the cumulative driving hours logged against
 * those loads, writes one ComplianceRecord, and routes any out-of-service
 * outcome load back to the maintenance queue (revert — a compliance
 * review always happens after Delivered, further along than the flagged
 * status, so this is necessarily backward).
 */
export async function finalizeCompliance(routeId: string, actorId: string) {
  const actor = await prisma.user.findUniqueOrThrow({ where: { id: actorId } });

  const route = await prisma.route.findUniqueOrThrow({
    where: { id: routeId },
    include: {
      complianceRecord: true,
      stops: {
        include: {
          load: {
            include: {
              inspections: { orderBy: { submittedAt: "desc" }, take: 1 },
              currentStatus: true,
            },
          },
        },
      },
    },
  });

  if (route.companyId !== actor.companyId) {
    throw new WorkflowError("Route does not belong to actor's company");
  }
  if (route.complianceRecord) {
    throw new WorkflowError("Route has already been finalized");
  }

  let passCount = 0;
  let minorDefectCount = 0;
  let outOfServiceCount = 0;
  const oosLoadIds: string[] = [];

  for (const stop of route.stops) {
    const latestInspection = stop.load.inspections[0];
    if (!latestInspection) continue;
    const effectiveOutcome = latestInspection.overrideOutcome ?? latestInspection.overallOutcome;
    if (effectiveOutcome === "out_of_service") {
      outOfServiceCount++;
      oosLoadIds.push(stop.load.id);
    } else if (effectiveOutcome === "minor_defect") {
      minorDefectCount++;
    } else if (effectiveOutcome === "pass") {
      passCount++;
    }
  }

  const loadIds = route.stops.map((s) => s.load.id);
  const drivingEntries = await prisma.dutyStatusEntry.findMany({
    where: { loadId: { in: loadIds }, dutyStatus: "driving", endedAt: { not: null } },
  });
  const totalHosHours = drivingEntries.reduce((sum, e) => {
    return sum + (e.endedAt!.getTime() - e.startedAt.getTime()) / (1000 * 60 * 60);
  }, 0);

  const record = await prisma.complianceRecord.create({
    data: {
      companyId: route.companyId,
      routeId: route.id,
      reviewedById: actorId,
      passCount,
      minorDefectCount,
      outOfServiceCount,
      totalHosHours,
    },
  });

  const oosStatus = await prisma.dispatchStatus.findFirst({
    where: { companyId: route.companyId, isFlaggedStatus: true },
  });

  const reroutedLoadIds: string[] = [];
  if (oosStatus) {
    for (const loadId of oosLoadIds) {
      try {
        await revert(loadId, oosStatus.id, actorId);
        reroutedLoadIds.push(loadId);
      } catch {
        // Load already flagged, or some other non-fatal state mismatch —
        // finalization itself still succeeds either way.
      }
    }
  }

  return { record, reroutedLoadIds };
}
