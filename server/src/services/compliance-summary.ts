import prisma from "../lib/prisma";
import { WorkflowError } from "./eligibility";

export interface ComplianceSummaryData {
  routeReference: string;
  finalizedAt: Date;
  reviewedByName: string;
  passCount: number;
  minorDefectCount: number;
  outOfServiceCount: number;
  totalHosHours: number;
  defects: { loadReference: string; vehicleUnitNumber: string; driverName: string; defectCategoryName: string; outcome: string; note: string | null }[];
  hosByDriver: { driverName: string; hours: number }[];
}

/**
 * getComplianceSummaryData — FR-43. Re-derives defect and HOS detail
 * live from Inspection/InspectionDefect/DutyStatusEntry, the same
 * "recompute, don't duplicate-store" pattern finalizeCompliance's own
 * aggregate counting already uses — a finalized route's loads never
 * change after finalization, so this is stable, not a race.
 */
export async function getComplianceSummaryData(routeId: string, companyId: string): Promise<ComplianceSummaryData> {
  const route = await prisma.route.findFirst({
    where: { id: routeId, companyId },
    include: {
      complianceRecord: { include: { reviewedBy: { select: { name: true } } } },
      stops: {
        include: {
          load: {
            include: {
              inspections: {
                orderBy: { submittedAt: "desc" },
                take: 1,
                include: { defects: { include: { defectCategory: { select: { name: true } } } } },
              },
              driver: { select: { name: true } },
              vehicle: { select: { unitNumber: true } },
            },
          },
        },
        orderBy: { sequence: "asc" },
      },
    },
  });
  if (!route) throw new WorkflowError("Route not found");
  if (!route.complianceRecord) throw new WorkflowError("Route has not been finalized yet");

  const defects: ComplianceSummaryData["defects"] = [];
  const loadIds: string[] = [];
  for (const stop of route.stops) {
    loadIds.push(stop.load.id);
    const latestInspection = stop.load.inspections[0];
    if (!latestInspection) continue;
    for (const defect of latestInspection.defects) {
      defects.push({
        loadReference: stop.load.reference,
        vehicleUnitNumber: stop.load.vehicle?.unitNumber ?? "—",
        driverName: stop.load.driver?.name ?? "—",
        defectCategoryName: defect.defectCategory.name,
        outcome: latestInspection.overrideOutcome ?? latestInspection.overallOutcome ?? "—",
        note: defect.note,
      });
    }
  }

  const drivingEntries = await prisma.dutyStatusEntry.findMany({
    where: { loadId: { in: loadIds }, dutyStatus: "driving", endedAt: { not: null } },
    include: { driver: { select: { name: true } } },
  });
  const hosByDriverMap = new Map<string, number>();
  for (const entry of drivingEntries) {
    const hours = (entry.endedAt!.getTime() - entry.startedAt.getTime()) / (1000 * 60 * 60);
    hosByDriverMap.set(entry.driver.name, (hosByDriverMap.get(entry.driver.name) ?? 0) + hours);
  }
  const hosByDriver = Array.from(hosByDriverMap.entries()).map(([driverName, hours]) => ({ driverName, hours }));

  return {
    routeReference: route.reference,
    finalizedAt: route.complianceRecord.finalizedAt,
    reviewedByName: route.complianceRecord.reviewedBy.name,
    passCount: route.complianceRecord.passCount,
    minorDefectCount: route.complianceRecord.minorDefectCount,
    outOfServiceCount: route.complianceRecord.outOfServiceCount,
    totalHosHours: route.complianceRecord.totalHosHours,
    defects,
    hosByDriver,
  };
}

function renderDefectTable(defects: ComplianceSummaryData["defects"]): string {
  if (defects.length === 0) return "  (no defects recorded)";
  return defects
    .map((d) => `  ${d.loadReference} | Unit ${d.vehicleUnitNumber} | ${d.driverName} | ${d.defectCategoryName} (${d.outcome})${d.note ? `: ${d.note}` : ""}`)
    .join("\n");
}

function renderHosTable(hosByDriver: ComplianceSummaryData["hosByDriver"]): string {
  if (hosByDriver.length === 0) return "  (no driving hours recorded)";
  return hosByDriver.map((h) => `  ${h.driverName}: ${h.hours.toFixed(1)}h`).join("\n");
}

/**
 * renderInternalSummary — FR-43. Template-driven: intro/closing are
 * admin-editable (Setting key compliance_summary_template), the defect
 * and HOS tables are always fixed-format.
 */
export function renderInternalSummary(data: ComplianceSummaryData, template: { intro: string; closing: string }): string {
  const substitute = (text: string) =>
    text
      .replace(/\{\{routeReference\}\}/g, data.routeReference)
      .replace(/\{\{finalizedAt\}\}/g, data.finalizedAt.toLocaleString())
      .replace(/\{\{reviewedByName\}\}/g, data.reviewedByName);

  return [
    substitute(template.intro),
    "",
    `Pass: ${data.passCount}  Minor Defect: ${data.minorDefectCount}  Out of Service: ${data.outOfServiceCount}  Total HOS: ${data.totalHosHours.toFixed(1)}h`,
    "",
    "Defects:",
    renderDefectTable(data.defects),
    "",
    "Hours of Service by Driver:",
    renderHosTable(data.hosByDriver),
    "",
    substitute(template.closing),
  ].join("\n");
}

/**
 * renderExternalAuditSummary — FR-43. Fixed format, no template, no
 * merge fields, no admin editing surface — per FR-43's own wording.
 */
export function renderExternalAuditSummary(data: ComplianceSummaryData): string {
  return [
    `EXTERNAL AUDIT EXPORT — Route ${data.routeReference}`,
    `Finalized: ${data.finalizedAt.toISOString()}`,
    `Reviewed by: ${data.reviewedByName}`,
    "",
    `Pass: ${data.passCount}`,
    `Minor Defect: ${data.minorDefectCount}`,
    `Out of Service: ${data.outOfServiceCount}`,
    `Total Hours of Service: ${data.totalHosHours.toFixed(1)}h`,
    "",
    "Defects:",
    renderDefectTable(data.defects),
    "",
    "Hours of Service by Driver:",
    renderHosTable(data.hosByDriver),
  ].join("\n");
}

/**
 * getFinalizedRoutes — FR-43. Companion to the existing getComplianceQueue
 * (which only lists unfinalized routes) — once a route is finalized it
 * disappears from that queue entirely, so the summary-viewer UI needs
 * its own listing to attach the summary buttons to.
 */
export async function getFinalizedRoutes(companyId: string) {
  return prisma.route.findMany({
    where: { companyId, complianceRecord: { isNot: null } },
    include: { complianceRecord: true },
    orderBy: { complianceRecord: { finalizedAt: "desc" } },
  });
}
