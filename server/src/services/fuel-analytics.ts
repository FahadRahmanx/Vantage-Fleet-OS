const EFFICIENCY_CURVE_MPG: Record<string, number> = {
  truck: 6.5,
  trailer: 6.5,
  van: 12,
  other: 8,
};

const DEVIATION_FLAG_THRESHOLD_PERCENT = 15;

export interface FuelEstimate {
  expectedGallons: number;
  deviationPercent: number | null;
  deviationFlag: boolean;
}

/**
 * estimateFuelConsumption — FR-56. A fixed manufacturer efficiency curve by
 * vehicle type (unrecognized types fall back to "other"). deviationPercent
 * is null (and deviationFlag false) when no actual usage is given to
 * compare against.
 */
export function estimateFuelConsumption(
  distanceMiles: number,
  vehicleType: string,
  actualGallonsUsed?: number
): FuelEstimate {
  const mpg = EFFICIENCY_CURVE_MPG[vehicleType] ?? EFFICIENCY_CURVE_MPG.other;
  const expectedGallons = distanceMiles / mpg;

  if (actualGallonsUsed === undefined) {
    return { expectedGallons, deviationPercent: null, deviationFlag: false };
  }

  const deviationPercent = ((actualGallonsUsed - expectedGallons) / expectedGallons) * 100;
  const deviationFlag = Math.abs(deviationPercent) > DEVIATION_FLAG_THRESHOLD_PERCENT;
  return { expectedGallons, deviationPercent, deviationFlag };
}
