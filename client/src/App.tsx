import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Link, Navigate, useNavigate } from "react-router-dom";
import { api, setToken, getToken, User, Load, DispatchStatus, DispatchTransition, Load as LoadType, StatusLog, UserRole } from "./api";
import LandingPage from "./landing/LandingPage";

// ─── Role capabilities (client-side mirror of server/src/middleware/permissions.ts) ───
// UI-only gating — the server is the real enforcement boundary (403s on
// disallowed writes regardless of what the client shows). This exists so
// each of the 6 roles sees the workspace relevant to it instead of every
// tab and action, matching the role-aware-landing intent from the
// architecture plan (§7, screen #2).

function canDispatchWrite(user: User): boolean {
  return user.platformAdmin || user.role === "dispatcher" || user.role === "fleet_admin";
}
function canConfigureWorkflow(user: User): boolean {
  return user.platformAdmin || user.role === "fleet_admin";
}
function canComplianceWrite(user: User): boolean {
  return user.platformAdmin || user.role === "compliance_officer" || user.role === "fleet_admin";
}

// Each role's primary workspace — where they land right after login.
const DEFAULT_PAGE_BY_ROLE: Record<User["role"], string> = {
  driver: "list",
  dispatcher: "dispatch-board",
  maintenance_tech: "maintenance",
  compliance_officer: "compliance",
  fleet_admin: "dispatch-board",
};

// ─── App Layout (authenticated) ─────────────────────────

function AppLayout() {
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<{ kind: string; loadId?: string }>({ kind: "list" });
  const navigate = useNavigate();

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored && getToken()) {
      const storedUser: User = JSON.parse(stored);
      setUser(storedUser);
      setPage({ kind: storedUser.platformAdmin ? "dispatch-board" : DEFAULT_PAGE_BY_ROLE[storedUser.role] });
    } else {
      navigate("/login");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("user");
    navigate("/login");
  };

  if (!user) return null;

  // Sidebar nav tabs — extend this list as later phases add screens.
  // `visible` gates which roles see the tab at all (UI convenience only —
  // the server is the real boundary). Loads and Audit History stay visible
  // to every role since both are row-scoped per-role server-side (driver
  // sees only their own), not capability-gated.
  const navItems: { key: string; label: string; active: boolean; visible: boolean; onClick: () => void }[] = [
    {
      key: "loads",
      label: "Loads",
      active: page.kind === "list" || page.kind === "create" || page.kind === "detail",
      visible: true,
      onClick: () => setPage({ kind: "list" }),
    },
    {
      key: "dispatch-board",
      label: "Dispatch Board",
      active: page.kind === "dispatch-board",
      visible: canDispatchWrite(user),
      onClick: () => setPage({ kind: "dispatch-board" }),
    },
    {
      key: "maintenance",
      label: "Maintenance",
      active: page.kind === "maintenance",
      visible: user.platformAdmin || user.role === "maintenance_tech" || user.role === "fleet_admin",
      onClick: () => setPage({ kind: "maintenance" }),
    },
    {
      key: "compliance",
      label: "Compliance",
      active: page.kind === "compliance",
      visible: canComplianceWrite(user),
      onClick: () => setPage({ kind: "compliance" }),
    },
    {
      key: "audit",
      label: "Audit History",
      active: page.kind === "audit",
      visible: true,
      onClick: () => setPage({ kind: "audit" }),
    },
    {
      key: "workflow-config",
      label: "Workflow Config",
      active: page.kind === "workflow-config",
      visible: canConfigureWorkflow(user),
      onClick: () => setPage({ kind: "workflow-config" }),
    },
  ];

  return (
    <div className="app-shell">
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src="/logo.svg" alt="" style={{ width: 28, height: 28, filter: "brightness(0) invert(1)" }} />
          <h1 style={{ fontSize: 18 }}>Vantage Fleet OS</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span className="user-info">{user.name} &middot; {user.role}</span>
          <button onClick={handleLogout}>Sign Out</button>
        </div>
      </div>
      <div className="app-body">
        <nav className="sidebar">
          {navItems.filter((item) => item.visible).map((item) => (
            <button
              key={item.key}
              className={`sidebar-tab${item.active ? " active" : ""}`}
              onClick={item.onClick}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="main-content">
          {page.kind === "list" && (
            <LoadList
              onSelect={(id) => setPage({ kind: "detail", loadId: id })}
              onNew={() => setPage({ kind: "create" })}
              canCreate={canDispatchWrite(user)}
            />
          )}
          {page.kind === "create" && (
            <CreateLoadPage
              onCreated={(id) => setPage({ kind: "detail", loadId: id })}
              onBack={() => setPage({ kind: "list" })}
            />
          )}
          {page.kind === "detail" && page.loadId && (
            <LoadDetail
              loadId={page.loadId}
              onBack={() => setPage({ kind: "list" })}
              user={user}
            />
          )}
          {page.kind === "dispatch-board" && (
            <DispatchBoardPage onSelect={(id) => setPage({ kind: "detail", loadId: id })} />
          )}
          {page.kind === "maintenance" && (
            <MaintenanceWorkbenchPage onSelect={(id) => setPage({ kind: "detail", loadId: id })} />
          )}
          {page.kind === "compliance" && <ComplianceWorkbenchPage />}
          {page.kind === "audit" && <AuditHistoryPage />}
          {page.kind === "workflow-config" && <WorkflowConfigPage />}
        </div>
      </div>
    </div>
  );
}

// ─── Login Page ───────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("dispatcher@test.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { token, user } = await api.login(email, password);
      setToken(token);
      onLogin(user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <Link to="/" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <img src="/logo.svg" alt="" style={{ width: 40, height: 40 }} />
          <h1>Vantage Fleet OS</h1>
        </Link>
        <p className="subtitle">Dispatch & Compliance Platform</p>
        {error && <div className="error">{error}</div>}
        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Link to="/" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>&larr; Back to home</Link>
        </div>
      </form>
    </div>
  );
}

function LoginPageRouter() {
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored && getToken()) {
      navigate("/app");
    }
  }, [navigate]);

  const handleLogin = (u: User) => {
    setUser(u);
    localStorage.setItem("user", JSON.stringify(u));
    navigate("/app");
  };

  if (user) return <Navigate to="/app" />;

  return <LoginPage onLogin={handleLogin} />;
}

// ─── Load List ────────────────────────────────────────────

function LoadList({ onSelect, onNew, canCreate }: { onSelect: (id: string) => void; onNew: () => void; canCreate: boolean }) {
  const [loads, setLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLoads().then(setLoads).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h2>Loads</h2>
        {canCreate && (
          <button className="btn btn-primary" onClick={onNew} style={{ width: "auto" }}>
            + New Load
          </button>
        )}
      </div>
      <div className="card">
        {loading ? (
          <div className="empty-state">Loading...</div>
        ) : loads.length === 0 ? (
          <div className="empty-state">
            <p>No loads yet.</p>
            {canCreate && (
              <button className="btn btn-secondary" onClick={onNew}>
                Create First Load
              </button>
            )}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Status</th>
                <th>Driver</th>
                <th>Vehicle</th>
              </tr>
            </thead>
            <tbody>
              {loads.map((load) => (
                <tr key={load.id} onClick={() => onSelect(load.id)}>
                  <td>{load.reference}</td>
                  <td>{load.origin}</td>
                  <td>{load.destination}</td>
                  <td>
                    <span className={`status-chip ${load.currentStatus.code}`}>
                      {load.currentStatus.name}
                    </span>
                  </td>
                  <td>{load.driver?.name || "—"}</td>
                  <td>{load.vehicle?.plate || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Dispatch Board ───────────────────────────────────────
// FR-36/37: columns are resolved from DispatchStatus's isDispatchStatus /
// isInTransitStatus flags, never from status code or name — renaming a
// status in Workflow Config must not break which column a load lands in.

function DispatchBoardPage({ onSelect }: { onSelect: (id: string) => void }) {
  const [loads, setLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLoads().then(setLoads).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state">Loading...</div>;

  const dispatchColumn = loads.filter((l) => l.currentStatus.isDispatchStatus);
  const inTransitColumn = loads.filter((l) => l.currentStatus.isInTransitStatus);

  const renderCard = (load: Load) => (
    <div key={load.id} className="card" style={{ marginBottom: 8, cursor: "pointer" }} onClick={() => onSelect(load.id)}>
      <div style={{ fontWeight: 600 }}>{load.reference}</div>
      <div style={{ fontSize: 13, color: "var(--text-muted, #666)" }}>{load.origin} → {load.destination}</div>
      <div style={{ fontSize: 13 }}>{load.driver?.name || "Unassigned"} &middot; {load.vehicle?.plate || "—"}</div>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h2>Dispatch Board</h2>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3>Assigned ({dispatchColumn.length})</h3>
          {dispatchColumn.length === 0 ? <div className="empty-state">No loads</div> : dispatchColumn.map(renderCard)}
        </div>
        <div style={{ flex: 1 }}>
          <h3>In Transit ({inTransitColumn.length})</h3>
          {inTransitColumn.length === 0 ? <div className="empty-state">No loads</div> : inTransitColumn.map(renderCard)}
        </div>
      </div>
    </div>
  );
}

// ─── Maintenance Workbench ──────────────────────────────
// FR-36: columns resolved from isFlaggedStatus / isInRepairStatus, never
// status code/name. "Claim" advances (same-rank, uses the default-target
// edge); "Complete Repair" reverts (backward-rank, back to Created) — both
// thin actions over the same generalized advance()/revert(), not a
// reimplementation.

function MaintenanceWorkbenchPage({ onSelect }: { onSelect: (id: string) => void }) {
  const [loads, setLoads] = useState<Load[]>([]);
  const [statuses, setStatuses] = useState<DispatchStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api.getLoads(), api.getStatuses()]).then(([l, s]) => {
      setLoads(l);
      setStatuses(s);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <div className="empty-state">Loading...</div>;

  const flaggedColumn = loads.filter((l) => l.currentStatus.isFlaggedStatus);
  const inRepairColumn = loads.filter((l) => l.currentStatus.isInRepairStatus);
  const createdStatus = statuses.find((s) => s.isDefault);

  const claim = async (loadId: string) => {
    setBusyId(loadId);
    try {
      // No explicit target — advance() resolves it via the isDefaultTarget
      // edge out of the current (flagged) status.
      await api.advance(loadId);
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  const completeRepair = async (loadId: string) => {
    if (!createdStatus) return;
    setBusyId(loadId);
    try {
      await api.revert(loadId, createdStatus.id);
      refresh();
    } finally {
      setBusyId(null);
    }
  };

  const renderCard = (load: Load, action: { label: string; onClick: () => void }) => (
    <div key={load.id} className="card" style={{ marginBottom: 8 }}>
      <div style={{ cursor: "pointer" }} onClick={() => onSelect(load.id)}>
        <div style={{ fontWeight: 600 }}>{load.reference}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted, #666)" }}>{load.vehicle?.plate || "—"}</div>
      </div>
      <button className="btn btn-secondary" style={{ marginTop: 8 }} disabled={busyId === load.id} onClick={action.onClick}>
        {busyId === load.id ? "Working..." : action.label}
      </button>
    </div>
  );

  return (
    <div>
      <div className="page-header">
        <h2>Maintenance Workbench</h2>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3>Flagged ({flaggedColumn.length})</h3>
          {flaggedColumn.length === 0 ? <div className="empty-state">No loads</div> : flaggedColumn.map((l) => renderCard(l, { label: "Claim for Repair", onClick: () => claim(l.id) }))}
        </div>
        <div style={{ flex: 1 }}>
          <h3>In Repair ({inRepairColumn.length})</h3>
          {inRepairColumn.length === 0 ? <div className="empty-state">No loads</div> : inRepairColumn.map((l) => renderCard(l, { label: "Complete Repair", onClick: () => completeRepair(l.id) }))}
        </div>
      </div>
    </div>
  );
}

// ─── Compliance Workbench ────────────────────────────────
// FR-41/42: per-route review, Finalize tallies outcomes + HOS and reroutes
// any out-of-service load back to maintenance.

function ComplianceWorkbenchPage() {
  const [queue, setQueue] = useState<{ id: string; reference: string; stops: { load: Load }[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getComplianceQueue().then(setQueue).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const finalize = async (routeId: string) => {
    setBusyId(routeId);
    setLastResult(null);
    try {
      const result = await api.finalizeCompliance(routeId);
      setLastResult(
        `Finalized: ${result.record.passCount} pass, ${result.record.minorDefectCount} minor defect, ${result.record.outOfServiceCount} out-of-service, ${result.record.totalHosHours.toFixed(1)}h logged.` +
        (result.reroutedLoadIds.length > 0 ? ` ${result.reroutedLoadIds.length} load(s) routed back to maintenance.` : "")
      );
      refresh();
    } catch (e: any) {
      setLastResult(`Error: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Compliance Workbench</h2>
      </div>
      {lastResult && <div className="card" style={{ marginBottom: 12 }}>{lastResult}</div>}
      {queue.length === 0 ? (
        <div className="empty-state">No routes awaiting review</div>
      ) : (
        queue.map((route) => (
          <div key={route.id} className="card" style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>{route.reference}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted, #666)" }}>
              {route.stops.length} load(s): {route.stops.map((s) => s.load.reference).join(", ")}
            </div>
            <button className="btn btn-primary" style={{ marginTop: 8, width: "auto" }} disabled={busyId === route.id} onClick={() => finalize(route.id)}>
              {busyId === route.id ? "Finalizing..." : "Finalize Review"}
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Audit History ────────────────────────────────────────
// FR-35: standalone, company-wide (row-scoped for driver) browsable log,
// distinct from Load Detail's embedded per-load trail.

function AuditHistoryPage() {
  const [logs, setLogs] = useState<(StatusLog & { load: { id: string; reference: string } })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getAuditLog().then(setLogs).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Audit History</h2>
      </div>
      <div className="card">
        {logs.length === 0 ? (
          <div className="empty-state">No audit entries yet.</div>
        ) : (
          logs.map((log) => (
            <div className="audit-row" key={log.id}>
              <span style={{ fontWeight: 600 }}>{log.load.reference}</span>
              <span className={`status-chip ${log.fromStatus.code}`}>{log.fromStatus.name}</span>
              <span className="arrow">{log.reverted ? "←" : "→"}</span>
              <span className={`status-chip ${log.toStatus.code}`}>{log.toStatus.name}</span>
              <span style={{ marginLeft: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>
                by {log.actor.name}{log.reverted ? " (reverted)" : ""}
              </span>
              <span className="time">{new Date(log.createdAt).toLocaleString()}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Create Load Form ─────────────────────────────────────

function CreateLoadPage({ onCreated, onBack }: { onCreated: (id: string) => void; onBack: () => void }) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const load = await api.createLoad(origin, destination);
      onCreated(load.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="back-link" onClick={onBack}>&larr; Back to Loads</div>
      <div className="card" style={{ maxWidth: 500 }}>
        <h2 style={{ marginBottom: 16 }}>New Load</h2>
        {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Origin</label>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Destination</label>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Load"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Load Detail ──────────────────────────────────────────

interface LoadDetailProps {
  loadId: string;
  onBack: () => void;
  user: User;
}

function LoadDetail({ loadId, onBack, user }: LoadDetailProps) {
  const [load, setLoad] = useState<LoadType | null>(null);
  const [statuses, setStatuses] = useState<DispatchStatus[]>([]);
  const [transitions, setTransitions] = useState<DispatchTransition[]>([]);
  const [targetStatus, setTargetStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const refresh = useCallback(() => {
    Promise.all([
      api.getLoad(loadId),
      api.getStatuses(),
      api.getTransitions(),
    ]).then(([l, s, t]) => {
      setLoad(l);
      setStatuses(s);
      setTransitions(t);
    }).finally(() => setLoading(false));
  }, [loadId]);

  useEffect(() => { refresh(); }, [refresh]);

  const allowedTransitions = load
    ? transitions
        .filter((t) => t.fromStatus.id === load.currentStatus.id)
        .map((t) => t.toStatus)
    : [];

  const handleAdvance = async () => {
    if (!targetStatus) return;
    setActionLoading(true);
    setError("");
    try {
      await api.advance(loadId, targetStatus);
      setTargetStatus("");
      refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevert = async () => {
    if (!targetStatus) return;
    setActionLoading(true);
    setError("");
    try {
      await api.revert(loadId, targetStatus);
      setTargetStatus("");
      refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading || !load) {
    return <div className="empty-state">Loading...</div>;
  }

  return (
    <div>
      <div className="back-link" onClick={onBack}>&larr; Back to Loads</div>
      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h2>Load Details — {load.reference}</h2>
          <span className={`status-chip ${load.currentStatus.code}`}>
            {load.currentStatus.name}
          </span>
        </div>
        <div className="detail-grid">
          <div>
            <div className="detail-field">
              <div className="label">Origin</div>
              <div className="value">{load.origin}</div>
            </div>
            <div className="detail-field">
              <div className="label">Destination</div>
              <div className="value">{load.destination}</div>
            </div>
            <div className="detail-field">
              <div className="label">Created By</div>
              <div className="value">{load.creator.name}</div>
            </div>
          </div>
          <div>
            <div className="detail-field">
              <div className="label">Driver</div>
              <div className="value">{load.driver?.name || "Not assigned"}</div>
            </div>
            <div className="detail-field">
              <div className="label">Vehicle</div>
              <div className="value">{load.vehicle ? `${load.vehicle.plate} (${load.vehicle.make} ${load.vehicle.model})` : "Not assigned"}</div>
            </div>
          </div>
        </div>
      </div>

      {!load.driver && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 16 }}>Assign Driver & Vehicle</h3>
          <AssignmentForm loadId={loadId} onAssigned={refresh} />
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Change Status</h3>
        {allowedTransitions.length === 0 ? (
          <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>
            No transitions available from current status.
          </p>
        ) : (
          <div className="workflow-controls">
            <select value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)}>
              <option value="">Select target status...</option>
              {allowedTransitions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              className="btn btn-success"
              disabled={!targetStatus || actionLoading}
              onClick={handleAdvance}
            >
              {actionLoading ? "Working..." : "Advance"}
            </button>
            <button
              className="btn btn-danger"
              disabled={!targetStatus || actionLoading}
              onClick={handleRevert}
            >
              {actionLoading ? "Working..." : "Revert"}
            </button>
          </div>
        )}
      </div>

      {load.statusLogs && load.statusLogs.length > 0 && (
        <div className="card audit-trail">
          <h3 style={{ marginBottom: 12, fontSize: 16 }}>Audit Trail</h3>
          {load.statusLogs.map((log) => (
            <div className="audit-row" key={log.id}>
              <span className={`status-chip ${log.fromStatus.code}`}>{log.fromStatus.name}</span>
              <span className="arrow">{log.reverted ? "←" : "→"}</span>
              <span className={`status-chip ${log.toStatus.code}`}>{log.toStatus.name}</span>
              <span style={{ marginLeft: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>
                by {log.actor.name}{log.reverted ? " (reverted)" : ""}
              </span>
              <span className="time">{new Date(log.createdAt).toLocaleString()}</span>
              {log.comment && (
                <div style={{ fontSize: 13, marginTop: 4, fontStyle: "italic" }}>"{log.comment}"</div>
              )}
              {log.capturedData?.eligibility && (
                <div style={{ fontSize: 13, marginTop: 4, color: "var(--color-text-secondary)" }}>
                  Eligibility: {log.capturedData.eligibility.before.reasonCode} &rarr; {log.capturedData.eligibility.after.reasonCode}
                </div>
              )}
              {log.capturedData?.inspection && (
                <div style={{ fontSize: 13, marginTop: 4, color: "var(--color-text-secondary)" }}>
                  DVIR routed this transition{log.capturedData.inspection.overrideOutcome ? ` (overridden: ${log.capturedData.inspection.overrideOutcome} — ${log.capturedData.inspection.overrideReason})` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Assignment Form ──────────────────────────────────────

function AssignmentForm({ loadId, onAssigned }: { loadId: string; onAssigned: () => void }) {
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reasonCode: string; reason?: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/drivers", { headers: { Authorization: `Bearer ${getToken()}` } }).then(r => r.json()),
      fetch("/api/vehicles", { headers: { Authorization: `Bearer ${getToken()}` } }).then(r => r.json()),
    ]).then(([d, v]) => {
      setDrivers(d);
      setVehicles(v);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!driverId || !vehicleId) {
      setEligibility(null);
      return;
    }
    api.getDriverEligibility(driverId, vehicleId).then(setEligibility).catch(() => setEligibility(null));
  }, [driverId, vehicleId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api.assignDriver(loadId, driverId, vehicleId);
      onAssigned();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 16 }}>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Driver</label>
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} required>
            <option value="">Select driver...</option>
            {drivers.map((d: any) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Vehicle</label>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
            <option value="">Select vehicle...</option>
            {vehicles.map((v: any) => (
              <option key={v.id} value={v.id}>{v.plate} — {v.make} {v.model}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "auto" }}>
            {loading ? "Assigning..." : "Assign"}
          </button>
        </div>
      </div>
      {eligibility && (
        <div className={`eligibility-badge ${eligibility.eligible ? "eligible" : "ineligible"}`} style={{ marginTop: 12 }}>
          {eligibility.eligible ? "Eligible" : `Ineligible — ${eligibility.reasonCode.replace(/_/g, " ")}`}
        </div>
      )}
    </form>
  );
}

// ─── Workflow Configuration ────────────────────────────────

const ALL_ROLES: UserRole[] = ["driver", "dispatcher", "maintenance_tech", "compliance_officer", "fleet_admin"];

// Flags that decide which workbench column a status lands in — this is the
// whole point of the data-driven engine: renaming a status must not break
// Dispatch/Maintenance/Compliance, only these flags do.
const STATUS_FLAGS: { key: keyof DispatchStatus; label: string; hint: string }[] = [
  { key: "isDefault", label: "Default (starting) status", hint: "New loads start here. Exactly one per company." },
  { key: "requiresEligibilityCheck", label: "Requires eligibility check", hint: "Advancing into this status runs the driver/vehicle/HOS eligibility gate." },
  { key: "isDispatchStatus", label: "Dispatch Board — Assigned column", hint: "Loads here show in the Dispatch Board's left column." },
  { key: "isInTransitStatus", label: "Dispatch Board — In Transit column", hint: "Loads here show in the Dispatch Board's right column." },
  { key: "isFlaggedStatus", label: "Maintenance — Flagged column", hint: "Loads here show in the Maintenance Workbench's left column." },
  { key: "isInRepairStatus", label: "Maintenance — In Repair column", hint: "Loads here show in the Maintenance Workbench's right column." },
  { key: "isComplianceReviewQueue", label: "Compliance review queue", hint: "Routes with a load here are eligible for compliance finalization." },
];

function WorkflowConfigPage() {
  const [statuses, setStatuses] = useState<DispatchStatus[]>([]);
  const [transitions, setTransitions] = useState<DispatchTransition[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [position, setPosition] = useState("0");
  const [roleVisibility, setRoleVisibility] = useState<string[]>(["dispatcher", "fleet_admin"]);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [fromStatusId, setFromStatusId] = useState("");
  const [toStatusId, setToStatusId] = useState("");
  const [isDefaultTarget, setIsDefaultTarget] = useState(false);
  const [outcomeTrigger, setOutcomeTrigger] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    Promise.all([api.getStatuses(), api.getTransitions()]).then(([s, t]) => {
      setStatuses(s);
      setTransitions(t);
    });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleRole = (role: string) => {
    setRoleVisibility((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const handleAddStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.createStatus({ name, code, position: Number(position), roleVisibility, ...flags });
      setName("");
      setCode("");
      setPosition("0");
      setRoleVisibility(["dispatcher", "fleet_admin"]);
      setFlags({});
      refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddTransition = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api.createTransition({ fromStatusId, toStatusId, isDefaultTarget, outcomeTrigger: outcomeTrigger || undefined });
      setFromStatusId("");
      setToStatusId("");
      setIsDefaultTarget(false);
      setOutcomeTrigger("");
      refresh();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Workflow Configuration</h2>
      </div>
      <p style={{ marginBottom: 16, fontSize: 13, color: "var(--color-text-secondary)" }}>
        Statuses and transitions define the dispatch flow entirely from data — no code change or deploy needed. A status's
        flags decide which workbench column it appears in and whether advancing into it runs the eligibility check.
        Its role visibility decides which roles may advance/revert a load out of it. A transition's "Default target"
        is where advance() goes when no explicit target is given; "Outcome trigger" auto-routes a load there when a
        DVIR inspection computes that outcome.
      </p>
      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Statuses</h3>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Position</th>
                <th>Role Visibility</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.code}</td>
                  <td>{s.position}</td>
                  <td style={{ fontSize: 12 }}>{s.roleVisibility.join(", ") || "—"}</td>
                  <td style={{ fontSize: 12 }}>
                    {STATUS_FLAGS.filter((f) => s[f.key]).map((f) => f.label).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={handleAddStatus} style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="form-group" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
              <label>Code</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} required />
            </div>
            <div className="form-group" style={{ width: 100, marginBottom: 0 }}>
              <label>Position</label>
              <input type="number" value={position} onChange={(e) => setPosition(e.target.value)} required />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Role visibility (who can advance/revert out of this status)</label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
              {ALL_ROLES.map((role) => (
                <label key={role} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="checkbox" checked={roleVisibility.includes(role)} onChange={() => toggleRole(role)} />
                  {role}
                </label>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Flags</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              {STATUS_FLAGS.map((f) => (
                <label key={f.key} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }} title={f.hint}>
                  <input
                    type="checkbox"
                    checked={!!flags[f.key]}
                    onChange={(e) => setFlags((prev) => ({ ...prev, [f.key]: e.target.checked }))}
                  />
                  {f.label}
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>— {f.hint}</span>
                </label>
              ))}
            </div>
          </div>

          <button className="btn btn-primary" type="submit" style={{ width: "auto", marginTop: 12 }}>Add Status</button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Transitions</h3>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th>Default Target</th>
                <th>Outcome Trigger</th>
              </tr>
            </thead>
            <tbody>
              {transitions.map((t) => (
                <tr key={t.id}>
                  <td>{t.fromStatus.name}</td>
                  <td>{t.toStatus.name}</td>
                  <td>{t.isDefaultTarget ? "Yes" : ""}</td>
                  <td>{t.outcomeTrigger || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form onSubmit={handleAddTransition} style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="form-group" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
            <label>From Status</label>
            <select value={fromStatusId} onChange={(e) => setFromStatusId(e.target.value)} required>
              <option value="">Select...</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
            <label>To Status</label>
            <select value={toStatusId} onChange={(e) => setToStatusId(e.target.value)} required>
              <option value="">Select...</option>
              {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ minWidth: 160, marginBottom: 0 }}>
            <label>Outcome trigger (DVIR auto-route)</label>
            <select value={outcomeTrigger} onChange={(e) => setOutcomeTrigger(e.target.value)}>
              <option value="">None (manual only)</option>
              <option value="pass">pass</option>
              <option value="minor_defect">minor_defect</option>
              <option value="out_of_service">out_of_service</option>
            </select>
          </div>
          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
            <input type="checkbox" checked={isDefaultTarget} onChange={(e) => setIsDefaultTarget(e.target.checked)} />
            Default target
          </label>
          <button className="btn btn-primary" type="submit" style={{ width: "auto" }}>Add Transition</button>
        </form>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPageRouter />} />
      <Route path="/app" element={<AppLayout />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
