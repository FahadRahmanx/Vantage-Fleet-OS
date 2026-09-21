// FR-53: a static registry of sidebar items × role eligibility, mirroring
// the existing hardcoded `visible` predicates in client/src/App.tsx's
// AppLayout navItems. Items whose visibility depends on more than role
// alone (my-hos needs a linked driverId, dev-tools needs DEV) or that no
// non-admin role can ever see (settings, notification-template,
// compliance-summary-template — all platformAdmin-only) are excluded; they
// stay fixed, non-customizable nav items on the client.
export const ALL_ROLES = ["driver", "dispatcher", "maintenance_tech", "compliance_officer", "fleet_admin"] as const;
export type AssignableRole = (typeof ALL_ROLES)[number];

export interface NavRegistryItem {
  key: string;
  label: string;
  eligibleRoles: readonly AssignableRole[];
}

export const NAV_REGISTRY: NavRegistryItem[] = [
  { key: "dashboard", label: "Dashboard", eligibleRoles: ALL_ROLES },
  { key: "loads", label: "Loads", eligibleRoles: ALL_ROLES },
  { key: "audit", label: "Audit History", eligibleRoles: ALL_ROLES },
  { key: "help", label: "Help", eligibleRoles: ALL_ROLES },
  { key: "dispatch-board", label: "Dispatch Board", eligibleRoles: ["dispatcher", "fleet_admin"] },
  { key: "routes", label: "Routes", eligibleRoles: ["dispatcher", "fleet_admin"] },
  { key: "uploads", label: "Bulk Import", eligibleRoles: ["dispatcher", "fleet_admin"] },
  { key: "users", label: "Users", eligibleRoles: ["fleet_admin"] },
  { key: "carriers", label: "Carrier Companies", eligibleRoles: ["fleet_admin"] },
  { key: "fleet-vehicles", label: "Vehicles", eligibleRoles: ["fleet_admin"] },
  { key: "fleet-drivers", label: "Drivers", eligibleRoles: ["fleet_admin"] },
  { key: "defect-categories", label: "Defect Categories", eligibleRoles: ["fleet_admin"] },
  { key: "vehicle-type-classes", label: "Vehicle Type Classes", eligibleRoles: ["fleet_admin"] },
  { key: "maintenance-interval-templates", label: "Maintenance Intervals", eligibleRoles: ["fleet_admin"] },
  { key: "fuel-analytics", label: "Fuel Analytics", eligibleRoles: ["fleet_admin"] },
  { key: "reports", label: "Reports", eligibleRoles: ["fleet_admin"] },
  { key: "maintenance", label: "Maintenance", eligibleRoles: ["maintenance_tech", "fleet_admin"] },
  { key: "triage", label: "Triage", eligibleRoles: ["maintenance_tech", "fleet_admin"] },
  { key: "compliance", label: "Compliance", eligibleRoles: ["compliance_officer", "fleet_admin"] },
  { key: "help-admin", label: "Help Articles", eligibleRoles: ["fleet_admin"] },
  { key: "workflow-config", label: "Workflow Config", eligibleRoles: ["fleet_admin"] },
];

export interface NavLayout {
  order: string[];
  hidden: string[];
}

export const EMPTY_NAV_LAYOUT: NavLayout = { order: [], hidden: [] };

/**
 * resolveNavForRole — reorders/hides within what's eligible, never widens
 * access. Items not yet present in layout.order are "not yet decided," not
 * hidden — that's what makes newly-registered items auto-appear without
 * any special-casing.
 */
export function resolveNavForRole(role: AssignableRole, layout: NavLayout, registry: NavRegistryItem[] = NAV_REGISTRY): string[] {
  const eligible = registry.filter((item) => item.eligibleRoles.includes(role));
  const eligibleKeys = new Set(eligible.map((item) => item.key));

  const known = new Set(layout.order);
  const ordered = [
    ...layout.order,
    ...eligible.filter((item) => !known.has(item.key)).map((item) => item.key),
  ];

  const hidden = new Set(layout.hidden);
  return ordered.filter((key) => eligibleKeys.has(key) && !hidden.has(key));
}
