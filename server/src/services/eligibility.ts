import prisma from "../lib/prisma";

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

/**
 * Check if a driver is eligible for assignment.
 * Single rule (FR-22 simplified): license and medical cert must not be expired.
 */
export async function checkEligibility(driverId: string): Promise<{ eligible: boolean; reason?: string }> {
  const driver = await prisma.driver.findUniqueOrThrow({ where: { id: driverId } });
  const now = new Date();

  if (driver.licenseExpiry <= now) {
    return { eligible: false, reason: `License expired on ${driver.licenseExpiry.toISOString().split("T")[0]}` };
  }
  if (driver.medicalCertExpiry <= now) {
    return { eligible: false, reason: `Medical cert expired on ${driver.medicalCertExpiry.toISOString().split("T")[0]}` };
  }
  return { eligible: true };
}
