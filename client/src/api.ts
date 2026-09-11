// Empty means same-origin, which is the normal deployment: one reverse
// proxy serves the built client and forwards /api and /auth to the API.
// Set VITE_API_BASE_URL only when the API is on a different origin, e.g.
// VITE_API_BASE_URL=https://api.vantage-fleet.duckdns.org
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export type UserRole = "driver" | "dispatcher" | "maintenance_tech" | "compliance_officer" | "fleet_admin";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  platformAdmin: boolean;
  driverId?: string | null;
  companyId: string;
}

export interface DutyStatusEntry {
  id: string;
  driverId: string;
  loadId?: string | null;
  dutyStatus: "driving" | "on_duty_not_driving" | "off_duty" | "sleeper_berth";
  startedAt: string;
  endedAt?: string | null;
}

export interface Company {
  id: string;
  name: string;
}

export interface UploadRow {
  id: string;
  rowIndex: number;
  carrierName?: string | null;
  vehicleUnitNo?: string | null;
  driverName?: string | null;
  origin?: string | null;
  destination?: string | null;
  matchedVehicleId?: string | null;
  matchedDriverId?: string | null;
  hosNote?: string | null;
  errors: string[];
  status: "ok" | "error";
}

export interface CarrierCompany {
  id: string;
  name: string;
  contactName?: string | null;
  contactEmail?: string | null;
  documentExpiryAlertDays?: number | null;
  defaultVehicleId?: string | null;
}

export interface UserAccount {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  platformAdmin: boolean;
  driverId?: string | null;
  status: "invited" | "active";
  createdAt: string;
}

export type DashboardScope = "personal" | "role" | "company";

export interface Dashboard {
  id: string;
  companyId: string;
  scope: DashboardScope;
  ownerId?: string | null;
  role?: UserRole | null;
  widgetKeys: string[];
  updatedAt: string;
}

export interface WidgetData {
  value?: number;
  labels?: string[];
  values?: number[];
}

export interface Upload {
  id: string;
  companyId: string;
  mode: "standard" | "legacy";
  status: "pending" | "validated" | "complete" | "failed";
  fileName: string;
  totalRows: number;
  errorRows: number;
  createdLoadIds: string[];
  createdBy: { id: string; name: string };
  createdAt: string;
  rows?: UploadRow[];
}

export interface Driver {
  id: string;
  name: string;
  licenseExpiry: string;
  licenseClass?: string | null;
  endorsements?: string[];
  medicalCertExpiry: string;
  homeTerminal?: string | null;
  hosRulesetId?: string | null;
  adminStatus?: "active" | "suspended";
  carrierCompanyId?: string | null;
  companyId: string;
}

export interface Vehicle {
  id: string;
  vin?: string;
  make: string;
  model: string;
  year?: number | null;
  plate: string;
  unitNumber?: string;
  fuelType?: string | null;
  odometer?: number;
  registrationExpiry?: string | null;
  insuranceExpiry?: string | null;
  status?: "active" | "in_maintenance" | "out_of_service" | "retired";
  homeTerminal?: string | null;
  carrierCompanyId?: string | null;
  companyId: string;
  type?: "truck" | "trailer" | "van" | "other";
}

export interface HosRuleset {
  id: string;
  name: string;
  maxDrivingHoursPerCycle: number;
  maxOnDutyWindowHours: number;
  minOffDutyResetHours: number;
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

export interface Setting {
  id: string;
  companyId: string;
  key: string;
  value: string;
  updatedAt: string;
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
  _count?: { documents: number };
}

export type LoadDocumentType = "bill_of_lading" | "pod" | "other";

export interface LoadDocument {
  id: string;
  loadId: string;
  type: LoadDocumentType;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  url: string;
}

export interface DefectCategory {
  id: string;
  name: string;
  outcome: "pass" | "minor_defect" | "out_of_service";
  requiresTechnicianNote: boolean;
  excludedVehicleTypes: string[];
  active?: boolean;
}

/** A route in the compliance queue, carrying each load's latest inspection. */
export interface ComplianceQueueRoute {
  id: string;
  reference: string;
  createdAt: string;
  stops: {
    sequence: number;
    load: Load & {
      driver: { name: string } | null;
      vehicle: { unitNumber: string; plate: string } | null;
      inspections: {
        id: string;
        type: "pre_trip" | "post_trip";
        overallOutcome: "pass" | "minor_defect" | "out_of_service" | null;
        overrideOutcome?: "pass" | "minor_defect" | "out_of_service" | null;
        overrideReason?: string | null;
        submittedAt: string;
        defects: { id: string; note?: string | null; defectCategory: { name: string; outcome: string } }[];
      }[];
    };
  }[];
}

export interface Inspection {
  id: string;
  type: "pre_trip" | "post_trip";
  odometerReading?: number | null;
  overallOutcome: "pass" | "minor_defect" | "out_of_service" | null;
  overrideOutcome?: "pass" | "minor_defect" | "out_of_service" | null;
  overrideReason?: string | null;
  submittedAt: string;
  driver: { name: string };
  vehicle: { unitNumber: string; plate: string };
  defects: { id: string; note?: string | null; defectCategory: { name: string; outcome: string } }[];
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
  login: (email: string, password: string, rememberMe?: boolean) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, rememberMe }),
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
    color?: string;
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

  getDutyStatusEntries: (driverId: string) =>
    request<DutyStatusEntry[]>(`/api/duty-status?driverId=${driverId}`),
  logDutyStatus: (data: { driverId: string; dutyStatus: string; startedAt: string; endedAt?: string }) =>
    request<DutyStatusEntry>("/api/duty-status", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getDriverAvailability: (driverId: string) =>
    request<{ drivingHoursUsed: number; onDutyHoursUsed: number; availableDriveHours: number; availableOnDutyHours: number; lastQualifyingResetAt: string | null }>(
      `/api/duty-status/${driverId}/availability`
    ),

  getDefectCategories: (vehicleId?: string) =>
    request<DefectCategory[]>(`/api/defect-categories${vehicleId ? `?vehicleId=${vehicleId}` : ""}`),

  createDefectCategory: (data: Partial<DefectCategory>) =>
    request<DefectCategory>("/api/defect-categories", { method: "POST", body: JSON.stringify(data) }),

  updateDefectCategory: (id: string, data: Partial<DefectCategory>) =>
    request<DefectCategory>(`/api/defect-categories/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  getInspections: (loadId: string) => request<Inspection[]>(`/api/inspections?loadId=${loadId}`),
  submitInspection: (data: {
    loadId: string;
    vehicleId: string;
    driverId: string;
    type: "pre_trip" | "post_trip";
    odometerReading?: number;
    defectEntries: { defectCategoryId: string; note?: string }[];
    overrideOutcome?: string;
    overrideReason?: string;
  }) =>
    request<{ inspection: { id: string; overallOutcome: string }; advance: { load: { id: string; currentStatusId: string } } }>("/api/inspections", {
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

  getComplianceQueue: () => request<ComplianceQueueRoute[]>("/api/compliance/queue"),
  finalizeCompliance: (routeId: string) =>
    request<{
      record: { id: string; passCount: number; minorDefectCount: number; outOfServiceCount: number; totalHosHours: number };
      reroutedLoadIds: string[];
    }>(`/api/compliance/${routeId}/finalize`, { method: "POST" }),

  getUploads: () => request<Upload[]>("/api/uploads"),
  getUpload: (id: string) => request<Upload>(`/api/uploads/${id}`),

  downloadUploadTemplate: async () => {
    const res = await fetch(`${API_BASE}/api/uploads/template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "load-import-template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  },

  createUpload: async (file: File, mode: "standard" | "legacy") => {
    const form = new FormData();
    form.append("file", file);
    form.append("mode", mode);
    const res = await fetch(`${API_BASE}/api/uploads`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<Upload>;
  },

  addUploadAlias: (uploadId: string, kind: "carrier" | "vehicle" | "driver", aliasText: string, targetId: string) =>
    request<Upload>(`/api/uploads/${uploadId}/aliases`, {
      method: "POST",
      body: JSON.stringify({ kind, aliasText, targetId }),
    }),

  confirmUpload: (uploadId: string) =>
    request<Upload>(`/api/uploads/${uploadId}/confirm`, { method: "POST" }),

  getUsers: (params: { role?: string; status?: string; q?: string } = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => !!v) as [string, string][]).toString();
    return request<UserAccount[]>(`/api/users${query ? `?${query}` : ""}`);
  },

  inviteUser: (data: { firstName: string; lastName: string; email: string; role: UserRole; carrierCompanyId?: string; driverId?: string }) =>
    request<UserAccount>("/api/users/invite", { method: "POST", body: JSON.stringify(data) }),

  updateUser: (id: string, data: { role?: UserRole; carrierCompanyId?: string; platformAdmin?: boolean }) =>
    request<UserAccount>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  resendInvite: (id: string) => request<UserAccount>(`/api/users/${id}/resend-invite`, { method: "POST" }),

  getCarrierCompanies: () => request<CarrierCompany[]>("/api/carrier-companies"),

  getInvitePreview: (token: string) =>
    request<{ name: string; email: string; role: UserRole }>(`/auth/invite/${token}`),

  acceptInvite: (token: string, password: string) =>
    request<{ token: string; user: User }>("/auth/accept-invite", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  forgotPassword: (email: string) =>
    request<{ ok: boolean }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  getDashboards: () => request<{ personal: Dashboard; role: Dashboard; company: Dashboard }>("/api/dashboards"),

  getRoleDashboard: (role: UserRole) =>
    request<{ role: Dashboard }>(`/api/dashboards?role=${role}`).then((r) => r.role),

  updateDashboard: (id: string, widgetKeys: string[]) =>
    request<Dashboard>(`/api/dashboards/${id}`, { method: "PATCH", body: JSON.stringify({ widgetKeys }) }),

  getDashboardData: (id: string) => request<Record<string, WidgetData>>(`/api/dashboards/${id}/data`),

  getLoadDocuments: (loadId: string) => request<LoadDocument[]>(`/api/loads/${loadId}/documents`),

  uploadLoadDocument: async (loadId: string, file: File, type: LoadDocumentType) => {
    const form = new FormData();
    form.append("file", file);
    form.append("type", type);
    const res = await fetch(`${API_BASE}/api/loads/${loadId}/documents`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<LoadDocument>;
  },

  deleteLoadDocument: async (loadId: string, documentId: string) => {
    const res = await fetch(`${API_BASE}/api/loads/${loadId}/documents/${documentId}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
  },

  getSettings: () => request<Setting[]>("/api/settings"),

  updateSetting: (key: string, value: string) =>
    request<Setting>(`/api/settings/${key}`, { method: "PUT", body: JSON.stringify({ value }) }),

  getDrivers: () => request<Driver[]>("/api/drivers"),
  createDriver: (data: Partial<Driver>) =>
    request<Driver>("/api/drivers", { method: "POST", body: JSON.stringify(data) }),
  updateDriver: (id: string, data: Partial<Driver>) =>
    request<Driver>(`/api/drivers/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getVehicles: () => request<Vehicle[]>("/api/vehicles"),
  createVehicle: (data: Partial<Vehicle>) =>
    request<Vehicle>("/api/vehicles", { method: "POST", body: JSON.stringify(data) }),
  updateVehicle: (id: string, data: Partial<Vehicle>) =>
    request<Vehicle>(`/api/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  createCarrierCompany: (data: Partial<CarrierCompany>) =>
    request<CarrierCompany>("/api/carrier-companies", { method: "POST", body: JSON.stringify(data) }),
  updateCarrierCompany: (id: string, data: Partial<CarrierCompany>) =>
    request<CarrierCompany>(`/api/carrier-companies/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  getHosRulesets: () => request<HosRuleset[]>("/api/hos-rulesets"),
};
