import { UserRole } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuthPayload } from "../middleware/auth";
import { WorkflowError } from "./eligibility";
import { WIDGET_KEYS, runWidget } from "./widgets";

async function getOrCreatePersonal(auth: AuthPayload) {
  const existing = await prisma.dashboard.findFirst({
    where: { companyId: auth.companyId, scope: "personal", ownerId: auth.userId },
  });
  if (existing) return existing;
  return prisma.dashboard.create({
    data: { companyId: auth.companyId, scope: "personal", ownerId: auth.userId, widgetKeys: [] },
  });
}

async function getOrCreateRole(companyId: string, role: UserRole) {
  const existing = await prisma.dashboard.findFirst({ where: { companyId, scope: "role", role } });
  if (existing) return existing;
  return prisma.dashboard.create({ data: { companyId, scope: "role", role, widgetKeys: [] } });
}

async function getOrCreateCompany(companyId: string) {
  const existing = await prisma.dashboard.findFirst({ where: { companyId, scope: "company" } });
  if (existing) return existing;
  return prisma.dashboard.create({ data: { companyId, scope: "company", widgetKeys: [] } });
}

/**
 * getDashboards — GET /api/dashboards. The actor's own personal, own
 * role, and company dashboard, auto-provisioning any missing ones.
 */
export async function getDashboards(auth: AuthPayload) {
  const [personal, role, company] = await Promise.all([
    getOrCreatePersonal(auth),
    getOrCreateRole(auth.companyId, auth.role),
    getOrCreateCompany(auth.companyId),
  ]);
  return { personal, role, company };
}

/**
 * getRoleDashboard — the ?role= override for canManageDashboards actors
 * (gated at the route, not here — this function itself doesn't check
 * capability, matching how e.g. getDrivers's carrierCompanyId filter is
 * unguarded at the service layer and gated by the route's middleware).
 */
export async function getRoleDashboard(companyId: string, role: UserRole) {
  return getOrCreateRole(companyId, role);
}

function canEditDashboard(
  dashboard: { scope: string; ownerId: string | null },
  auth: AuthPayload,
  canManage: boolean
): boolean {
  if (dashboard.scope === "personal") return dashboard.ownerId === auth.userId;
  return canManage;
}

function canReadDashboard(
  dashboard: { scope: string; ownerId: string | null; role: UserRole | null },
  auth: AuthPayload,
  canManage: boolean
): boolean {
  if (dashboard.scope === "company") return true;
  if (dashboard.scope === "personal") return dashboard.ownerId === auth.userId;
  if (dashboard.scope === "role") return dashboard.role === auth.role || canManage;
  return false;
}

/**
 * updateDashboard — PATCH /api/dashboards/:id. Validates widget keys
 * before any write; a personal dashboard is owner-only, role/company
 * need canManageDashboards.
 */
export async function updateDashboard(dashboardId: string, widgetKeys: string[], auth: AuthPayload, canManage: boolean) {
  const invalid = widgetKeys.filter((k) => !WIDGET_KEYS.includes(k));
  if (invalid.length > 0) {
    throw new WorkflowError(`Unknown widget key(s): ${invalid.join(", ")}`);
  }

  const dashboard = await prisma.dashboard.findFirst({ where: { id: dashboardId, companyId: auth.companyId } });
  if (!dashboard) throw new WorkflowError("Dashboard not found");
  if (!canEditDashboard(dashboard, auth, canManage)) {
    throw new WorkflowError("Not authorized to edit this dashboard");
  }

  return prisma.dashboard.update({ where: { id: dashboardId }, data: { widgetKeys } });
}

/**
 * getDashboardData — GET /api/dashboards/:id/data. Runs every enabled
 * widget's query, scoped to the requesting actor (not the dashboard's
 * owner) — a company dashboard viewed by a driver still only shows that
 * driver's own loads, since runWidget always scopes by the passed auth.
 */
export async function getDashboardData(dashboardId: string, auth: AuthPayload, canManage: boolean) {
  const dashboard = await prisma.dashboard.findFirst({ where: { id: dashboardId, companyId: auth.companyId } });
  if (!dashboard) throw new WorkflowError("Dashboard not found");
  if (!canReadDashboard(dashboard, auth, canManage)) {
    throw new WorkflowError("Not authorized to view this dashboard");
  }

  const entries = await Promise.all(
    dashboard.widgetKeys.map(async (key) => [key, await runWidget(key, auth)] as const)
  );
  return Object.fromEntries(entries);
}
