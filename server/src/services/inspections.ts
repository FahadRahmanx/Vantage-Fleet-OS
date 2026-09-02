import { DefectCategory, InspectionType, InspectionOutcome } from "@prisma/client";
import prisma from "../lib/prisma";
import { advanceInTx, AdvancePayload } from "./workflow";
import { WorkflowError } from "./eligibility";

/**
 * computeInspectionOutcome(defectEntries, categories)
 *
 * FR-28's exact priority: any out-of-service -> out-of-service; else any
 * minor-defect -> minor-defect; else pass.
 */
export function computeInspectionOutcome(
  defectEntries: { defectCategoryId: string }[],
  categories: DefectCategory[]
): InspectionOutcome {
  const outcomes = defectEntries.map((e) => categories.find((c) => c.id === e.defectCategoryId)!.outcome);
  if (outcomes.includes("out_of_service")) return "out_of_service";
  if (outcomes.includes("minor_defect")) return "minor_defect";
  return "pass";
}

export interface SubmitInspectionParams {
  loadId: string;
  vehicleId: string;
  driverId: string;
  type: InspectionType;
  odometerReading?: number;
  defectEntries: { defectCategoryId: string; note?: string }[];
  overrideOutcome?: InspectionOutcome;
  overrideReason?: string;
  actorId: string;
}

/**
 * submitInspection(params)
 *
 * FR-28: one transaction — create the Inspection + defects, compute the
 * outcome, then advance() the load through whichever transition matches
 * that outcome (or the override). Same transaction as the advance, via
 * advanceInTx — never a submitted DVIR without a matching status change,
 * or vice versa.
 */
export async function submitInspection(params: SubmitInspectionParams) {
  if (params.overrideOutcome && !params.overrideReason) {
    throw new WorkflowError("Override requires a reason");
  }

  return prisma.$transaction(async (tx) => {
    const load = await tx.load.findUniqueOrThrow({ where: { id: params.loadId } });

    const inspection = await tx.inspection.create({
      data: {
        loadId: params.loadId,
        vehicleId: params.vehicleId,
        driverId: params.driverId,
        companyId: load.companyId,
        type: params.type,
        odometerReading: params.odometerReading,
        overrideOutcome: params.overrideOutcome,
        overrideReason: params.overrideReason,
        submittedById: params.actorId,
        defects: { create: params.defectEntries },
      },
      include: { defects: true },
    });

    const categories = await tx.defectCategory.findMany({
      where: { id: { in: params.defectEntries.map((d) => d.defectCategoryId) } },
    });
    const outcome = computeInspectionOutcome(params.defectEntries, categories);

    const updatedInspection = await tx.inspection.update({
      where: { id: inspection.id },
      data: { overallOutcome: outcome },
    });

    const advancePayload: AdvancePayload = {
      inspectionId: inspection.id,
      overrideOutcome: params.overrideOutcome,
      overrideReason: params.overrideReason,
    };
    const advanceResult = await advanceInTx(tx, params.loadId, undefined, params.actorId, advancePayload);

    return { inspection: updatedInspection, advance: advanceResult };
  }, { timeout: 30000 });
}
