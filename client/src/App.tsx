import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Link, Navigate, useNavigate } from "react-router-dom";
import { api, setToken, getToken, User, Load, DispatchStatus, DispatchTransition, Load as LoadType } from "./api";
import LandingPage from "./landing/LandingPage";

// ─── App Layout (authenticated) ─────────────────────────

function AppLayout() {
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<{ kind: string; loadId?: string }>({ kind: "list" });
  const navigate = useNavigate();

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored && getToken()) {
      setUser(JSON.parse(stored));
    } else {
      navigate("/login");
    }
  }, [navigate]);

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("user");
    navigate("/login");
  };

  if (!user) return null;

  // Sidebar nav tabs — extend this list as later phases add screens
  // (e.g. Workflow Configuration in Phase 1). "list"/"create"/"detail"
  // all fall under the "loads" tab since they're the same section.
  const navItems: { key: string; label: string; active: boolean }[] = [
    { key: "loads", label: "Loads", active: page.kind === "list" || page.kind === "create" || page.kind === "detail" },
  ];

  return (
    <div className="app-shell">
      <div className="topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src="/logo.svg" alt="" style={{ width: 20, height: 20, filter: "brightness(0) invert(1)" }} />
          <h1>Vantage Fleet OS</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span className="user-info">{user.name} &middot; {user.role}</span>
          <button onClick={handleLogout}>Sign Out</button>
        </div>
      </div>
      <div className="app-body">
        <nav className="sidebar">
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`sidebar-tab${item.active ? " active" : ""}`}
              onClick={() => setPage({ kind: "list" })}
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
        <Link to="/" style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <img src="/logo.svg" alt="" style={{ width: 28, height: 28 }} />
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

function LoadList({ onSelect, onNew }: { onSelect: (id: string) => void; onNew: () => void }) {
  const [loads, setLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLoads().then(setLoads).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h2>Loads</h2>
        <button className="btn btn-primary" onClick={onNew} style={{ width: "auto" }}>
          + New Load
        </button>
      </div>
      <div className="card">
        {loading ? (
          <div className="empty-state">Loading...</div>
        ) : loads.length === 0 ? (
          <div className="empty-state">
            <p>No loads yet.</p>
            <button className="btn btn-secondary" onClick={onNew}>
              Create First Load
            </button>
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
              <span className="arrow">&rarr;</span>
              <span className={`status-chip ${log.toStatus.code}`}>{log.toStatus.name}</span>
              <span style={{ marginLeft: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>
                by {log.actor.name}
              </span>
              <span className="time">{new Date(log.createdAt).toLocaleString()}</span>
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

  useEffect(() => {
    Promise.all([
      fetch("/api/drivers", { headers: { Authorization: `Bearer ${getToken()}` } }).then(r => r.json()),
      fetch("/api/vehicles", { headers: { Authorization: `Bearer ${getToken()}` } }).then(r => r.json()),
    ]).then(([d, v]) => {
      setDrivers(d);
      setVehicles(v);
    }).catch(() => {});
  }, []);

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
    </form>
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
