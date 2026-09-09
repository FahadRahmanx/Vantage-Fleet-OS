import prisma from "../lib/prisma";

export interface HosSnapshot {
  drivingHoursUsed: number;
  onDutyHoursUsed: number;
  availableDriveHours: number;
  availableOnDutyHours: number;
  lastQualifyingResetAt: Date | null;
}

export interface HosRulesetValues {
  maxDrivingHoursPerCycle: number;
  maxOnDutyWindowHours: number;
  minOffDutyResetHours: number;
}

/**
 * computeHosAvailabilityFromValues(driverId, ruleset, atTime)
 *
 * FR-40, sum-based simplification (NOT the real FMCSA 14-hour wall-clock
 * window, 30-minute-break, or 60/70-hour rules): walk the driver's duty
 * entries backward from atTime, accumulating driving/on-duty time, until a
 * CONTIGUOUS off_duty/sleeper_berth span reaches the ruleset's
 * minOffDutyResetHours — that span is the "qualifying reset" (FR-40) and
 * everything before it stops counting. Always re-derived from raw entries,
 * never cached (RFP risk R-6's own mitigation: "re-derive server-side").
 *
 * Takes the ruleset's three numbers directly rather than a rulesetId, so
 * a caller with no persisted HosRuleset row (e.g. checkEligibility's
 * settings-store fallback, FR-55) can still run this calculation.
 */
export async function computeHosAvailabilityFromValues(
  driverId: string,
  ruleset: HosRulesetValues,
  atTime: Date = new Date()
): Promise<HosSnapshot> {
  const entries = await prisma.dutyStatusEntry.findMany({
    where: { driverId, startedAt: { lte: atTime } },
    orderBy: { startedAt: "desc" },
  });

  let drivingHoursUsed = 0;
  let onDutyHoursUsed = 0;
  let contiguousOffDutyHours = 0;
  let lastQualifyingResetAt: Date | null = null;
  let resetReached = false;

  for (const entry of entries) {
    const end = entry.endedAt ?? atTime;
    const start = entry.startedAt;
    const hours = Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);

    // isOnDuty: explicit per-entry override wins (FR-40); otherwise
    // driving/on_duty_not_driving default to on-duty, off_duty/sleeper_berth
    // default to off-duty.
    const isOnDuty = entry.onDutyOverride ?? (entry.dutyStatus === "driving" || entry.dutyStatus === "on_duty_not_driving");

    if (!resetReached) {
      if (isOnDuty) {
        contiguousOffDutyHours = 0;
        if (entry.dutyStatus === "driving") drivingHoursUsed += hours;
        onDutyHoursUsed += hours;
      } else {
        contiguousOffDutyHours += hours;
        if (contiguousOffDutyHours >= ruleset.minOffDutyResetHours) {
          resetReached = true;
          lastQualifyingResetAt = start;
        }
      }
    }
  }

  return {
    drivingHoursUsed,
    onDutyHoursUsed,
    availableDriveHours: Math.max(0, ruleset.maxDrivingHoursPerCycle - drivingHoursUsed),
    availableOnDutyHours: Math.max(0, ruleset.maxOnDutyWindowHours - onDutyHoursUsed),
    lastQualifyingResetAt,
  };
}

/**
 * computeHosAvailability(driverId, rulesetId, atTime)
 *
 * Unchanged signature and behavior — fetches the persisted HosRuleset row,
 * then delegates to computeHosAvailabilityFromValues. Existing callers
 * (routes/hos.ts, eligibility.ts's ruleset-assigned path, test-engine.ts)
 * are unaffected.
 */
export async function computeHosAvailability(
  driverId: string,
  rulesetId: string,
  atTime: Date = new Date()
): Promise<HosSnapshot> {
  const ruleset = await prisma.hosRuleset.findUniqueOrThrow({ where: { id: rulesetId } });
  return computeHosAvailabilityFromValues(driverId, ruleset, atTime);
}
