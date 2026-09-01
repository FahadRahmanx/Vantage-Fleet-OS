const API_BASE = "";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "dispatcher" | "fleet_admin";
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
}

export interface DispatchTransition {
  id: string;
  fromStatus: DispatchStatus;
  toStatus: DispatchStatus;
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

export interface StatusLog {
  id: string;
  fromStatus: DispatchStatus;
  toStatus: DispatchStatus;
  actor: Pick<User, "id" | "name">;
  createdAt: string;
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
  advance: (loadId: string, targetStatusId: string) =>
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
};
