import prisma from "../lib/prisma";
import { computeHosAvailability, computeHosAvailabilityFromValues, HosSnapshot } from "./hos";
import { getSetting } from "./settings";

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

  let hos: HosSnapshot;
  if (driver.hosRulesetId) {
    hos = await computeHosAvailability(driverId, driver.hosRulesetId, atTime);
  } else {
    // FR-55: no explicit ruleset assigned — fall back to the settings
    // store's reset threshold instead of skipping HOS entirely. The other
    // two HOS numbers use the same federal defaults seed.ts hardcodes for
    // a real HosRuleset, since FR-55 only names the reset threshold as
    // the configurable one.
    const resetThresholdRaw = await getSetting(driver.companyId, "hos_reset_threshold_hours", "10");
    const minOffDutyResetHours = parseFloat(resetThresholdRaw);
    hos = await computeHosAvailabilityFromValues(driverId, {
      maxDrivingHoursPerCycle: 11,
      maxOnDutyWindowHours: 14,
      minOffDutyResetHours: Number.isFinite(minOffDutyResetHours) ? minOffDutyResetHours : 10,
    }, atTime);
  }

  if (hos.availableDriveHours <= 0) {
    return {
      eligible: false,
      reasonCode: "HOURS_EXHAUSTED",
      reason: "Driver has no remaining available drive time",
      hos,
    };
  }

  return { eligible: true, reasonCode: "ELIGIBLE", hos };
}
