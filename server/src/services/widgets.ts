import prisma from "../lib/prisma";
import { AuthPayload } from "../middleware/auth";
import { scopeLoadsForActor } from "../middleware/permissions";

export type ChartType = "kpi" | "pie" | "bar" | "donut" | "line";

export interface WidgetDef {
  key: string;
  label: string;
  chartType: ChartType;
}

export const WIDGET_CATALOGUE: WidgetDef[] = [
  { key: "active_loads", label: "Active Loads", chartType: "kpi" },
  { key: "total_loads", label: "Total Loads", chartType: "kpi" },
  { key: "loads_this_month", label: "Loads This Month", chartType: "kpi" },
  { key: "loads_by_status", label: "Loads by Status", chartType: "pie" },
  { key: "loads_by_carrier", label: "Loads by Carrier", chartType: "bar" },
  { key: "loads_by_vehicle_type", label: "Loads by Vehicle Type", chartType: "donut" },
  { key: "loads_per_month", label: "Loads per Month", chartType: "line" },
];

export const WIDGET_KEYS = WIDGET_CATALOGUE.map((w) => w.key);

export interface KpiResult {
  value: number;
}

export interface SeriesResult {
  labels: string[];
  values: number[];
}

function bucket(values: string[]): SeriesResult {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return { labels: [...counts.keys()], values: [...counts.values()] };
}

/**
 * activeLoads — FR-49. "Active" is defined as not yet delivered; the
 * seeded workflow has no separate terminal/complete flag (spec §2).
 */
async function activeLoads(auth: AuthPayload): Promise<KpiResult> {
  const value = await prisma.load.count({
    where: scopeLoadsForActor(auth, { companyId: auth.companyId, currentStatus: { code: { not: "delivered" } } }),
  });
  return { value };
}

async function totalLoads(auth: AuthPayload): Promise<KpiResult> {
  const value = await prisma.load.count({ where: scopeLoadsForActor(auth, { companyId: auth.companyId }) });
  return { value };
}

async function loadsThisMonth(auth: AuthPayload): Promise<KpiResult> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const value = await prisma.load.count({
    where: scopeLoadsForActor(auth, { companyId: auth.companyId, createdAt: { gte: start } }),
  });
  return { value };
}

async function loadsByStatus(auth: AuthPayload): Promise<SeriesResult> {
  const loads = await prisma.load.findMany({
    where: scopeLoadsForActor(auth, { companyId: auth.companyId }),
    select: { currentStatus: { select: { name: true } } },
  });
  return bucket(loads.map((l) => l.currentStatus.name));
}

/**
 * loadsByCarrier — buckets by the assigned vehicle's carrier company.
 * A load with no vehicle, or a vehicle with no carrier, buckets as
 * "Unassigned" rather than being dropped (spec §4).
 */
async function loadsByCarrier(auth: AuthPayload): Promise<SeriesResult> {
  const loads = await prisma.load.findMany({
    where: scopeLoadsForActor(auth, { companyId: auth.companyId }),
    select: { vehicle: { select: { carrierCompany: { select: { name: true } } } } },
  });
  return bucket(loads.map((l) => l.vehicle?.carrierCompany?.name ?? "Unassigned"));
}

/**
 * loadsByVehicleType — buckets by Vehicle.make (spec §2 — no vehicleType
 * field exists). Loads with no assigned vehicle are excluded, not
 * bucketed, since "type of a vehicle that doesn't exist" isn't meaningful.
 */
async function loadsByVehicleType(auth: AuthPayload): Promise<SeriesResult> {
  const loads = await prisma.load.findMany({
    where: scopeLoadsForActor(auth, { companyId: auth.companyId, vehicleId: { not: null } }),
    select: { vehicle: { select: { make: true } } },
  });
  return bucket(loads.map((l) => l.vehicle!.make));
}

async function loadsPerMonth(auth: AuthPayload): Promise<SeriesResult> {
  const start = new Date();
  start.setMonth(start.getMonth() - 11);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const loads = await prisma.load.findMany({
    where: scopeLoadsForActor(auth, { companyId: auth.companyId, createdAt: { gte: start } }),
    select: { createdAt: true },
  });

  const months: string[] = [];
  const cursor = new Date(start);
  for (let i = 0; i < 12; i++) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const counts = Object.fromEntries(months.map((m) => [m, 0]));
  for (const l of loads) {
    const m = `${l.createdAt.getFullYear()}-${String(l.createdAt.getMonth() + 1).padStart(2, "0")}`;
    if (m in counts) counts[m]++;
  }

  return { labels: months, values: months.map((m) => counts[m]) };
}

const WIDGET_QUERIES: Record<string, (auth: AuthPayload) => Promise<KpiResult | SeriesResult>> = {
  active_loads: activeLoads,
  total_loads: totalLoads,
  loads_this_month: loadsThisMonth,
  loads_by_status: loadsByStatus,
  loads_by_carrier: loadsByCarrier,
  loads_by_vehicle_type: loadsByVehicleType,
  loads_per_month: loadsPerMonth,
};

/**
 * runWidget — dispatches to the right query by key. Throws a plain Error
 * (not WorkflowError) for an unknown key since this should be unreachable
 * in practice — callers (services/dashboards.ts) only ever pass keys
 * already validated against WIDGET_KEYS.
 */
export async function runWidget(key: string, auth: AuthPayload): Promise<KpiResult | SeriesResult> {
  const fn = WIDGET_QUERIES[key];
  if (!fn) throw new Error(`Unknown widget key: ${key}`);
  return fn(auth);
}
