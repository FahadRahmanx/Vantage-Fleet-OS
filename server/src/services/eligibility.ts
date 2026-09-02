import prisma from "../lib/prisma";
import { computeHosAvailability, HosSnapshot } from "./hos";

export class EligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EligibilityError";
  }
}

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export type EligibilityReasonCode =
  | "ELIGIBLE"
  | "EXPIRED_LICENSE"
  | "EXPIRED_MEDICAL"
  | "VEHICLE_OUT_OF_SERVICE"
  | "HOURS_EXHAUSTED";

export interface EligibilityResult {
  eligible: boolean;
  reasonCode: EligibilityReasonCode;
  reason?: string;
  hos: HosSnapshot;
}

const EMPTY_HOS: HosSnapshot = {
  drivingHoursUsed: 0,
  onDutyHoursUsed: 0,
  availableDriveHours: 0,
  availableOnDutyHours: 0,
  lastQualifyingResetAt: null,
};

/**
 * checkEligibility(driverId, vehicleId?, atTime?)
 *
 * FR-22/26, four-state check (order is a documented design choice, not an
 * RFP mandate — first failure wins): license expiry -> medical cert expiry
 * -> vehicle out-of-service (only if vehicleId given) -> HOS exhausted.
 */
export async function checkEligibility(
  driverId: string,
  vehicleId?: string,
  atTime: Date = new Date()
): Promise<EligibilityResult> {
  const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });

  if (driver.licenseExpiry <= atTime) {
    return {
      eligible: false,
      reasonCode: "EXPIRED_LICENSE",
      reason: `License expired on ${driver.licenseExpiry.toISOString().split("T")[0]}`,
      hos: EMPTY_HOS,
    };
  }
  if (driver.medicalCertExpiry <= atTime) {
    return {
      eligible: false,
      reasonCode: "EXPIRED_MEDICAL",
      reason: `Medical cert expired on ${driver.medicalCertExpiry.toISOString().split("T")[0]}`,
      hos: EMPTY_HOS,
    };
  }

  if (vehicleId) {
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: vehicleId } });
    if (vehicle.status === "out_of_service") {
      return {
        eligible: false,
        reasonCode: "VEHICLE_OUT_OF_SERVICE",
        reason: "Assigned vehicle is out of service",
        hos: EMPTY_HOS,
      };
    }
  }

  const hos = driver.hosRulesetId
    ? await computeHosAvailability(driverId, driver.hosRulesetId, atTime)
    : EMPTY_HOS;

  if (driver.hosRulesetId && hos.availableDriveHours <= 0) {
    return {
      eligible: false,
      reasonCode: "HOURS_EXHAUSTED",
      reason: "Driver has no remaining available drive time",
      hos,
    };
  }

  return { eligible: true, reasonCode: "ELIGIBLE", hos };
}
