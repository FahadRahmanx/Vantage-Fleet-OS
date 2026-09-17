import { FaultTriageStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { WorkflowError } from "./eligibility";

const FORWARD_STEP: Record<FaultTriageStatus, FaultTriageStatus | null> = {
  not_triaged: "in_repair",
  in_repair: "completed",
  completed: null,
};

/**
 * getVehicleTriageSummaries — FR-39. One row per vehicle that has at
 * least one InspectionDefect (open or historical), with bucket counts.
 * completed counts every historical completed fault too, so the card
 * shows the full lifecycle, not just open work.
 */
export async function getVehicleTriageSummaries(companyId: string) {
  const defects = await prisma.inspectionDefect.findMany({
    where: { inspection: { companyId } },
    include: { inspection: { include: { vehicle: true } } },
  });

  const byVehicle = new Map<string, { vehicleId: string; unitNumber: string; plate: string; total: number; notTriaged: number; inRepair: number; completed: number }>();
  for (const d of defects) {
    const v = d.inspection.vehicle;
    let entry = byVehicle.get(v.id);
    if (!entry) {
      entry = { vehicleId: v.id, unitNumber: v.unitNumber, plate: v.plate, total: 0, notTriaged: 0, inRepair: 0, completed: 0 };
      byVehicle.set(v.id, entry);
    }
    entry.total += 1;
    if (d.status === "not_triaged") entry.notTriaged += 1;
    else if (d.status === "in_repair") entry.inRepair += 1;
    else entry.completed += 1;
  }

  return Array.from(byVehicle.values()).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber));
}

/**
 * getVehicleFaults — FR-39. Every fault for one vehicle, plus a
 * mixedSeverities flag computed over that vehicle's OPEN faults'
 * distinct DefectCategory.outcome values.
 */
export async function getVehicleFaults(vehicleId: string, companyId: string) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, companyId } });
  if (!vehicle) throw new WorkflowError("Vehicle not found");

  const defects = await prisma.inspectionDefect.findMany({
    where: { inspection: { vehicleId, companyId } },
    include: { defectCategory: true, inspection: true },
    orderBy: { inspection: { submittedAt: "desc" } },
  });

  const openSeverities = new Set(defects.filter((d) => d.status !== "completed").map((d) => d.defectCategory.outcome));

  return {
    mixedSeverities: openSeverities.size > 1,
    faults: defects.map((d) => ({
      id: d.id,
      defectCategoryName: d.defectCategory.name,
      outcome: d.defectCategory.outcome,
      reportedDate: d.inspection.submittedAt,
      status: d.status,
      outOfServiceOverride: d.outOfServiceOverride,
      note: d.note,
    })),
  };
}

/**
 * recomputeVehicleOutOfService — internal. Sets the vehicle out_of_service
 * if any open fault is severity out_of_service or has the override
 * checked; otherwise, if it was out_of_service for this reason, drops it
 * to in_maintenance. Never auto-flips to active — that stays a human call.
 */
async function recomputeVehicleOutOfService(vehicleId: string) {
  const openDefects = await prisma.inspectionDefect.findMany({
    where: { inspection: { vehicleId }, status: { not: "completed" } },
    include: { defectCategory: true },
  });
  const shouldBeOutOfService = openDefects.some((d) => d.defectCategory.outcome === "out_of_service" || d.outOfServiceOverride);

  const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  if (shouldBeOutOfService && vehicle.status !== "out_of_service") {
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { status: "out_of_service" } });
  } else if (!shouldBeOutOfService && vehicle.status === "out_of_service") {
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { status: "in_maintenance" } });
  }
}

async function findDefectInCompany(defectId: string, companyId: string) {
  return prisma.inspectionDefect.findFirst({
    where: { id: defectId, inspection: { companyId } },
    include: { inspection: true },
  });
}

/**
 * confirmFault — FR-39. Advances one step (not_triaged->in_repair or
 * in_repair->completed). Throws if already completed.
 */
export async function confirmFault(defectId: string, companyId: string) {
  const defect = await findDefectInCompany(defectId, companyId);
  if (!defect) throw new WorkflowError("Fault not found");

  const next = FORWARD_STEP[defect.status];
  if (!next) throw new WorkflowError("Fault is already completed");

  const updated = await prisma.inspectionDefect.update({ where: { id: defect.id }, data: { status: next } });
  // Recompute on every transition, not just completion — an out-of-service
  // fault must force the vehicle out_of_service the moment it's still open
  // (e.g. moving from not_triaged to in_repair), not only once it's fixed.
  await recomputeVehicleOutOfService(defect.inspection.vehicleId);
  return updated;
}

/**
 * confirmAllInRepair — FR-39. Bulk-completes every in_repair fault for a
 * vehicle. Blocked while any not_triaged fault remains for that vehicle.
 */
export async function confirmAllInRepair(vehicleId: string, companyId: string) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, companyId } });
  if (!vehicle) throw new WorkflowError("Vehicle not found");

  const pendingDiagnosis = await prisma.inspectionDefect.count({
    where: { inspection: { vehicleId, companyId }, status: "not_triaged" },
  });
  if (pendingDiagnosis > 0) {
    throw new WorkflowError("Cannot confirm-all while pre-diagnosis faults remain");
  }

  await prisma.inspectionDefect.updateMany({
    where: { inspection: { vehicleId, companyId }, status: "in_repair" },
    data: { status: "completed" },
  });
  await recomputeVehicleOutOfService(vehicleId);
}

/**
 * overrideFaultStatus — FR-39. Compliance-officer escape hatch: sets
 * status directly to any value, no forward-only constraint.
 */
export async function overrideFaultStatus(defectId: string, companyId: string, newStatus: FaultTriageStatus) {
  const defect = await findDefectInCompany(defectId, companyId);
  if (!defect) throw new WorkflowError("Fault not found");

  const updated = await prisma.inspectionDefect.update({ where: { id: defect.id }, data: { status: newStatus } });
  await recomputeVehicleOutOfService(defect.inspection.vehicleId);
  return updated;
}

/**
 * setOutOfServiceOverride — FR-39. Auto-save toggle.
 */
export async function setOutOfServiceOverride(defectId: string, companyId: string, value: boolean) {
  const defect = await findDefectInCompany(defectId, companyId);
  if (!defect) throw new WorkflowError("Fault not found");

  const updated = await prisma.inspectionDefect.update({ where: { id: defect.id }, data: { outOfServiceOverride: value } });
  await recomputeVehicleOutOfService(defect.inspection.vehicleId);
  return updated;
}
