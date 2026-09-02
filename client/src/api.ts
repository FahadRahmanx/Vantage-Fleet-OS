const API_BASE = "";

export type UserRole = "driver" | "dispatcher" | "maintenance_tech" | "compliance_officer" | "fleet_admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  platformAdmin: boolean;
  companyId: string;
}

export interface Company {
  id: string;
  name: string;
}

export interface Driver {
  id: string;
  name: string;
  licenseExpiry: string;
  medicalCertExpiry: string;
  companyId: string;
}

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  plate: string;
  companyId: string;
}

export interface DispatchStatus {
  id: string;
  name: string;
  code: string;
  companyId: string;
  color?: string | null;
  position: number;
  isDefault: boolean;
  isDispatchStatus: boolean;
  isInTransitStatus: boolean;
  isFlaggedStatus: boolean;
  isInRepairStatus: boolean;
  isComplianceReviewQueue: boolean;
  requiresEligibilityCheck: boolean;
  roleVisibility: string[];
}

export interface DispatchTransition {
  id: string;
  fromStatus: DispatchStatus;
  toStatus: DispatchStatus;
  outcomeTrigger?: string | null;
  isDefaultTarget: boolean;
}

export interface Load {
  id: string;
  reference: string;
  origin: string;
  destination: string;
  currentStatus: DispatchStatus;
  driver: Driver | null;
  vehicle: Vehicle | null;
  creator: Pick<User, "id" | "name">;
  statusLogs?: StatusLog[];
  createdAt: string;
}

export interface DefectCategory {
  id: string;
  name: string;
  outcome: "pass" | "minor_defect" | "out_of_service";
  requiresTechnicianNote: boolean;
}

export interface StatusLog {
  id: string;
  fromStatus: DispatchStatus;
  toStatus: DispatchStatus;
  actor: Pick<User, "id" | "name">;
  createdAt: string;
  reverted: boolean;
  comment?: string | null;
  // FR-35's versioned snapshot: { version: 1, eligibility?: {before,after}, inspection?: {...} }
  capturedData?: {
    eligibility?: { before: { eligible: boolean; reasonCode: string }; after: { eligible: boolean; reasonCode: string } };
    inspection?: { id: string; overrideOutcome?: string; overrideReason?: string };
  } | null;
}

let token: string | null = localStorage.getItem("token");

export function setToken(t: string | null) {
  token = t;
  if (t) localStorage.setItem("token", t);
  else localStorage.removeItem("token");
}

export function getToken() {
  return token;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || body.reason || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  getLoads: () => request<Load[]>("/api/loads"),
  getLoad: (id: string) => request<Load>(`/api/loads/${id}`),
  createLoad: (origin: string, destination: string) =>
    request<Load>("/api/loads", {
      method: "POST",
      body: JSON.stringify({ origin, destination }),
    }),
  assignDriver: (loadId: string, driverId: string, vehicleId: string) =>
    request<Load>(`/api/loads/${loadId}/assign`, {
      method: "POST",
      body: JSON.stringify({ driverId, vehicleId }),
    }),
  advance: (loadId: string, targetStatusId?: string) =>
    request<{ load: Load; log: StatusLog }>(`/api/loads/${loadId}/advance`, {
      method: "POST",
      body: JSON.stringify({ targetStatusId }),
    }),
  revert: (loadId: string, targetStatusId: string) =>
    request<{ load: Load; log: StatusLog }>(`/api/loads/${loadId}/revert`, {
      method: "POST",
      body: JSON.stringify({ targetStatusId }),
    }),

  getStatuses: () => request<DispatchStatus[]>("/api/statuses"),
  getTransitions: () => request<DispatchTransition[]>("/api/statuses/transitions"),
  createStatus: (data: {
    name: string;
    code: string;
    position: number;
    roleVisibility?: string[];
    isDefault?: boolean;
    isDispatchStatus?: boolean;
    isInTransitStatus?: boolean;
    isFlaggedStatus?: boolean;
    isInRepairStatus?: boolean;
    isComplianceReviewQueue?: boolean;
    requiresEligibilityCheck?: boolean;
  }) =>
    request<DispatchStatus>("/api/statuses", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  createTransition: (data: { fromStatusId: string; toStatusId: string; isDefaultTarget?: boolean; outcomeTrigger?: string }) =>
    request<DispatchTransition>("/api/statuses/transitions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getDriverEligibility: (driverId: string, vehicleId: string) =>
    request<{ eligible: boolean; reasonCode: string; reason?: string; hos: { availableDriveHours: number } }>(
      `/api/drivers/${driverId}/eligibility?vehicleId=${vehicleId}`
    ),

  getDefectCategories: () => request<DefectCategory[]>("/api/defect-categories"),
  submitInspection: (data: {
    loadId: string;
    vehicleId: string;
    driverId: string;
    type: "pre_trip" | "post_trip";
    defectEntries: { defectCategoryId: string; note?: string }[];
    overrideOutcome?: string;
    overrideReason?: string;
  }) =>
    request<{ inspection: { id: string; overallOutcome: string }; advance: { load: Load } }>("/api/inspections", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getRoutes: () => request<{ id: string; reference: string; stops: { loadId: string; sequence: number; load: Load }[] }[]>("/api/routes"),
  createRoute: (loadIds: string[]) =>
    request<{ route: { id: string; reference: string }; autoAdvanced: string[] }>("/api/routes", {
      method: "POST",
      body: JSON.stringify({ loadIds }),
    }),

  getAuditLog: () => request<(StatusLog & { load: { id: string; reference: string } })[]>("/api/audit"),

  getComplianceQueue: () =>
    request<{ id: string; reference: string; stops: { load: Load }[] }[]>("/api/compliance/queue"),
  finalizeCompliance: (routeId: string) =>
    request<{
      record: { id: string; passCount: number; minorDefectCount: number; outOfServiceCount: number; totalHosHours: number };
      reroutedLoadIds: string[];
    }>(`/api/compliance/${routeId}/finalize`, { method: "POST" }),
};
