import prisma from "../lib/prisma";
import { WorkflowError } from "./eligibility";

export interface TelematicsPayload {
  vin: string;
  timestamp: string;
  mileage: number;
  engineHours: number;
  location?: string;
}

/**
 * normalizeTelematicsPayload — the adapter boundary. The POC only ever
 * calls this with an already-canonical shape (this mocked endpoint has no
 * real vendor to translate from), but it's the one place a real
 * Samsara/Motive integration would plug in later without touching
 * ingestTelematics itself (RFP risk R-1's mitigation).
 */
export function normalizeTelematicsPayload(raw: unknown): TelematicsPayload {
  const body = raw as Record<string, unknown>;
  if (typeof body.vin !== "string" || typeof body.mileage !== "number" || typeof body.engineHours !== "number") {
    throw new WorkflowError("Telematics payload requires vin (string), mileage (number), and engineHours (number)");
  }
  return {
    vin: body.vin,
    timestamp: typeof body.timestamp === "string" ? body.timestamp : new Date().toISOString(),
    mileage: body.mileage,
    engineHours: body.engineHours,
    location: typeof body.location === "string" ? body.location : undefined,
  };
}

/**
 * ingestTelematics(companyId, payload)
 *
 * FR-48: matches a vehicle by VIN, scoped to the token's company. Odometer
 * updates are monotonic — a stale/out-of-order reading is silently
 * ignored, not an error, since a real device can legitimately resend an
 * older event.
 */
export async function ingestTelematics(companyId: string, payload: TelematicsPayload) {
  const vehicle = await prisma.vehicle.findFirst({ where: { vin: payload.vin, companyId } });
  if (!vehicle) {
    throw new WorkflowError(`No vehicle with VIN "${payload.vin}" found for this company`);
  }

  return prisma.vehicle.update({
    where: { id: vehicle.id },
    data: {
      odometer: payload.mileage > vehicle.odometer ? payload.mileage : vehicle.odometer,
      engineHours: payload.engineHours,
      dataSource: "telematics_sync",
      lastTelematicsUpdateAt: new Date(payload.timestamp),
    },
  });
}
