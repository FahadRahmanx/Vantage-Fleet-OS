import { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { api, setToken, getToken, User, Load, DispatchStatus, DispatchTransition, Load as LoadType, StatusLog, UserRole, DefectCategory, DutyStatusEntry, Inspection, ComplianceQueueRoute } from "./api";
import LandingPage from "./landing/LandingPage";

// ─── Role capabilities (client-side mirror of server/src/middleware/permissions.ts) ───
// UI-only gating; the server is the real enforcement boundary (403s on
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

// Every role lands on the KPI dashboard first, matching the landing-page
// convention on comparable fleet SaaS products (Motive, Samsara) rather
// than dropping straight into a single workspace.
const DEFAULT_PAGE_BY_ROLE: Record<User["role"], string> = {
  driver: "dashboard",
  dispatcher: "dashboard",
  maintenance_tech: "dashboard",
  compliance_officer: "dashboard",
  fleet_admin: "dashboard",
};

// Unsplash portrait photo IDs for the topbar profile icon. Picked
// deterministically per user (by id) so the same person always gets the
// same avatar across sessions, rather than a random one on every reload.
const AVATAR_PHOTO_IDS = [
  "1494790108377-be9c29b29330",
  "1507003211169-0a1dd7228f2d",
  "1500648767791-00dcc994a43e",
  "1544005313-94ddf0286df2",
  "1472099645785-5658abf4ff4e",
  "1438761681033-6461ffad8d80",
  "1534528741775-53994a69daeb",
  "1517841905240-472988babdf9",
];

// StatusChip renders a status's own `color` (set in Workflow Config) when
// present, falling back to the .status-chip.<code> CSS classes for statuses
// created before color-picking existed or left blank. A status with no
// color no longer silently reuses the "Delivered" green chip by accident.
function StatusChip({ status, style }: { status: { code: string; name: string; color?: string | null }; style?: React.CSSProperties }) {
  const colorStyle = status.color ? { background: `${status.color}22`, color: status.color } : undefined;
  return (
    <span className={`status-chip ${status.code}`} style={{ ...colorStyle, ...style }}>
      {status.name}
    </span>
  );
}

function avatarUrlForUser(user: User): string {
  let hash = 0;
  for (let i = 0; i < user.id.length; i++) {
    hash = (hash * 31 + user.id.charCodeAt(i)) >>> 0;
  }
  const photoId = AVATAR_PHOTO_IDS[hash % AVATAR_PHOTO_IDS.length];
  return `https://images.unsplash.com/photo-${photoId}?w=80&h=80&fit=crop&crop=faces&q=80`;
}

// ─── App Layout (authenticated) ─────────────────────────

type Page = { kind: string; loadId?: string };

// Two-way mapping between page state and the URL, so the sidebar/detail
// navigation that already happens via setPage() is visible and shareable
// in the address bar instead of everything staying on the bare /app path.
function pageToPath(page: Page): string {
  switch (page.kind) {
    case "list": return "/app/loads";
    case "create": return "/app/loads/new";
    case "detail": return `/app/loads/${page.loadId}`;
    case "dvir": return `/app/loads/${page.loadId}/dvir`;
    default: return `/app/${page.kind}`;
  }
}

function pathToPage(pathname: string): Page | null {
  const parts = pathname.replace(/^\/app\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0] === "loads") {
    if (parts.length === 1) return { kind: "list" };
    if (parts[1] === "new") return { kind: "create" };
    if (parts.length === 2) return { kind: "detail", loadId: parts[1] };
    if (parts.length === 3 && parts[2] === "dvir") return { kind: "dvir", loadId: parts[1] };
    return null;
  }
  return { kind: parts[0] };
}

function AppLayout() {
  const [user, setUser] = useState<User | null>(null);
  const [page, setPageState] = useState<Page>({ kind: "list" });
  const navigate = useNavigate();
  const location = useLocation();

  // setPage pushes a matching browser URL alongside the state change, so
  // every tab switch, load click, or DVIR/Routes/etc. navigation shows up
  // in the address bar and can be bookmarked, shared, or reached via
  // back/forward.
  const setPage = useCallback((next: Page) => {
    setPageState(next);
    navigate(pageToPath(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    const stored = localStorage.getItem("user");
    if (stored && getToken()) {
      const storedUser: User = JSON.parse(stored);
      setUser(storedUser);
      // Deep link (a URL under /app that already names a page) wins over
      // the role default; a bare /app or /app/ falls back to it.
      const fromUrl = pathToPage(location.pathname);
      const initialPage = fromUrl ?? { kind: DEFAULT_PAGE_BY_ROLE[storedUser.role] };
      setPageState(initialPage);
      navigate(pageToPath(initialPage), { replace: true });
    } else {
      navigate("/login");
    }
    // Only meant to run once on mount to resolve the initial URL/page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser back/forward changes location.pathname without going through
  // setPage() above; catch that here and re-derive page state from the URL
  // so the back button actually works, not just forward navigation.
  useEffect(() => {
    const fromUrl = pathToPage(location.pathname);
    if (fromUrl && (fromUrl.kind !== page.kind || fromUrl.loadId !== page.loadId)) {
      setPageState(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("user");
    navigate("/login");
  };

  if (!user) return null;

  // Sidebar nav tabs; extend this list as later phases add screens.
  // `visible` gates which roles see the tab at all (UI convenience only;
  // the server is the real boundary). Loads and Audit History stay visible
  // to every role since both are row-scoped per-role server-side (driver
  // sees only their own), not capability-gated.
  const navItems: { key: string; label: string; active: boolean; visible: boolean; onClick: () => void }[] = [
    {
      key: "dashboard",
      label: "Dashboard",
      active: page.kind === "dashboard",
      visible: true,
      onClick: () => setPage({ kind: "dashboard" }),
    },
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
      key: "routes",
      label: "Routes",
      active: page.kind === "routes",
      visible: canDispatchWrite(user),
      onClick: () => setPage({ kind: "routes" }),
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
      key: "my-hos",
      label: "My Hours of Service",
      active: page.kind === "my-hos",
      visible: user.role === "driver" && !!user.driverId,
      onClick: () => setPage({ kind: "my-hos" }),
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
          <ProfileMenu user={user} onLogout={handleLogout} />
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
          {page.kind === "dashboard" && (
            <DashboardPage user={user} onNavigate={(kind) => setPage({ kind })} />
          )}
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
              onSubmitDvir={() => setPage({ kind: "dvir", loadId: page.loadId })}
            />
          )}
          {page.kind === "dvir" && page.loadId && (
            <DvirSubmitPage
              loadId={page.loadId}
              onDone={() => setPage({ kind: "detail", loadId: page.loadId! })}
              onBack={() => setPage({ kind: "detail", loadId: page.loadId! })}
            />
          )}
          {page.kind === "dispatch-board" && (
            <DispatchBoardPage onSelect={(id) => setPage({ kind: "detail", loadId: id })} />
          )}
          {page.kind === "routes" && (
            <RoutesPage onSelectLoad={(id) => setPage({ kind: "detail", loadId: id })} />
          )}
          {page.kind === "maintenance" && (
            <MaintenanceWorkbenchPage onSelect={(id) => setPage({ kind: "detail", loadId: id })} />
          )}
          {page.kind === "compliance" && <ComplianceWorkbenchPage />}
          {page.kind === "my-hos" && user.driverId && <DriverHosPage driverId={user.driverId} />}
          {page.kind === "audit" && <AuditHistoryPage />}
          {page.kind === "workflow-config" && <WorkflowConfigPage />}
        </div>
      </div>
    </div>
  );
}

// ─── Profile Menu ─────────────────────────────────────────

function ProfileMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: 0, border: "none", background: "none", cursor: "pointer" }}
        aria-label="Profile menu"
      >
        <span style={{ color: "#fff", fontSize: 14 }}>{user.name}</span>
        <img
          src={avatarUrlForUser(user)}
          alt={user.name}
          style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,0.3)" }}
        />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            minWidth: 200,
            zIndex: 10,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>{user.name}</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {user.role}{user.platformAdmin ? " (platform admin)" : ""}
            </div>
          </div>
          <button
            onClick={onLogout}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 16px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 14,
              color: "var(--color-text)",
            }}
          >
            Sign Out
          </button>
        </div>
      )}
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

// ─── Dashboard ────────────────────────────────────────────
// KPI landing page (RFP screen #2, deliberately a metrics summary rather
// than a single workspace) — the counts are all derived from data every
// role already has read access to, not a new backend endpoint. A driver's
// getLoads() is already row-scoped to their own loads server-side, so
// their card totals naturally reflect only their own work.

function KpiCard({ label, value, onClick }: { label: string; value: number; onClick?: () => void }) {
  return (
    <div
      className="card"
      style={{ flex: "1 1 160px", minWidth: 160, cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
    >
      <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 6 }}>{label}</div>
    </div>
  );
}

function DashboardPage({ user, onNavigate }: { user: User; onNavigate: (pageKind: string) => void }) {
  const [loads, setLoads] = useState<Load[] | null>(null);
  const [complianceQueueCount, setComplianceQueueCount] = useState<number | null>(null);

  useEffect(() => {
    api.getLoads().then(setLoads);
    if (canComplianceWrite(user)) {
      api.getComplianceQueue().then((q) => setComplianceQueueCount(q.length));
    }
  }, [user]);

  if (!loads) return <div className="empty-state">Loading...</div>;

  const assignedCount = loads.filter((l) => l.currentStatus.isDispatchStatus).length;
  const inTransitCount = loads.filter((l) => l.currentStatus.isInTransitStatus).length;
  const flaggedCount = loads.filter((l) => l.currentStatus.isFlaggedStatus).length;
  const inRepairCount = loads.filter((l) => l.currentStatus.isInRepairStatus).length;

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 16 }}>
        <KpiCard label="Total Loads" value={loads.length} onClick={() => onNavigate("list")} />
        {canDispatchWrite(user) && (
          <>
            <KpiCard label="Assigned" value={assignedCount} onClick={() => onNavigate("dispatch-board")} />
            <KpiCard label="In Transit" value={inTransitCount} onClick={() => onNavigate("dispatch-board")} />
          </>
        )}
        {(user.platformAdmin || user.role === "maintenance_tech" || user.role === "fleet_admin") && (
          <>
            <KpiCard label="Flagged for Maintenance" value={flaggedCount} onClick={() => onNavigate("maintenance")} />
            <KpiCard label="In Repair" value={inRepairCount} onClick={() => onNavigate("maintenance")} />
          </>
        )}
        {complianceQueueCount !== null && (
          <KpiCard label="Awaiting Compliance Review" value={complianceQueueCount} onClick={() => onNavigate("compliance")} />
        )}
      </div>

      {loads.length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 16 }}>Recent Loads</h3>
          {loads.slice(0, 5).map((l) => (
            <div className="audit-row" key={l.id} style={{ cursor: "pointer" }} onClick={() => onNavigate("list")}>
              <span style={{ fontWeight: 600 }}>{l.reference}</span>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{l.origin} to {l.destination}</span>
              <StatusChip status={l.currentStatus} style={{ marginLeft: "auto" }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Load List ────────────────────────────────────────────

function LoadList({ onSelect, onNew, canCreate }: { onSelect: (id: string) => void; onNew: () => void; canCreate: boolean }) {
  const [loads, setLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.getLoads().then(setLoads).finally(() => setLoading(false));
  }, []);

  const filterText = filter.trim().toLowerCase();
  const filteredLoads = filterText
    ? loads.filter((l) =>
        [l.reference, l.origin, l.destination, l.currentStatus.name, l.driver?.name, l.vehicle?.plate]
          .some((field) => field?.toLowerCase().includes(filterText))
      )
    : loads;

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
          <>
            <div className="form-group">
              <input
                placeholder="Filter by reference, origin, destination, status, driver, or vehicle..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            {filteredLoads.length === 0 ? (
              <div className="empty-state">No loads match "{filter}".</div>
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
                  {filteredLoads.map((load) => (
                    <tr key={load.id} onClick={() => onSelect(load.id)}>
                      <td>{load.reference}</td>
                      <td>{load.origin}</td>
                      <td>{load.destination}</td>
                      <td>
                        <StatusChip status={load.currentStatus} />
                      </td>
                      <td>{load.driver?.name || "—"}</td>
                      <td>{load.vehicle?.plate || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Board card ───────────────────────────────────────────
// Shared by the Dispatch Board and the Maintenance Workbench so a load
// reads the same on both: reference, route, who and what is on it, and
// the status it currently sits in. Unit number is included because that
// is how a technician identifies a truck, not the plate.

function LoadCard({ load, onSelect, action, busy }: {
  load: Load;
  onSelect: () => void;
  action?: { label: string; onClick: () => void };
  busy?: boolean;
}) {
  const vehicleLabel = load.vehicle
    ? [load.vehicle.unitNumber ? `Unit ${load.vehicle.unitNumber}` : null, load.vehicle.plate]
        .filter(Boolean)
        .join(" · ")
    : "No vehicle";

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div style={{ cursor: "pointer" }} onClick={onSelect}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 600 }}>{load.reference}</span>
          <StatusChip status={load.currentStatus} style={{ marginLeft: "auto" }} />
        </div>
        <div style={{ fontSize: 13, marginBottom: 2 }}>{load.origin} &rarr; {load.destination}</div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {load.driver?.name || "Unassigned"}
        </div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {vehicleLabel}
          {load.vehicle ? ` (${load.vehicle.make} ${load.vehicle.model})` : ""}
        </div>
      </div>
      {action && (
        <button className="btn btn-secondary" style={{ marginTop: 10 }} disabled={busy} onClick={action.onClick}>
          {busy ? "Working..." : action.label}
        </button>
      )}
    </div>
  );
}

// ─── Dispatch Board ───────────────────────────────────────
// FR-36/37: columns are resolved from DispatchStatus's isDispatchStatus /
// isInTransitStatus flags, never from status code or name. Renaming a
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
    <LoadCard key={load.id} load={load} onSelect={() => onSelect(load.id)} />
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
// edge); "Complete Repair" reverts (backward-rank, back to Created); both
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
      // No explicit target; advance() resolves it via the isDefaultTarget
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
    <LoadCard
      key={load.id}
      load={load}
      onSelect={() => onSelect(load.id)}
      action={action}
      busy={busyId === load.id}
    />
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

// ─── Routes ───────────────────────────────────────────────
// FR-38: group loads into a route; any attached load already assigned and
// eligible auto-advances (Dispatch Board's default-target fallback), same
// mechanism as a plain advance, just triggered from here.

function RoutesPage({ onSelectLoad }: { onSelectLoad: (loadId: string) => void }) {
  const [routes, setRoutes] = useState<{ id: string; reference: string; stops: { loadId: string; sequence: number; load: Load }[] }[]>([]);
  const [loads, setLoads] = useState<Load[]>([]);
  const [selectedLoadIds, setSelectedLoadIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(() => {
    Promise.all([api.getRoutes(), api.getLoads()]).then(([r, l]) => {
      setRoutes(r);
      setLoads(l);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const routedLoadIds = new Set(routes.flatMap((r) => r.stops.map((s) => s.loadId)));
  const unroutedLoads = loads.filter((l) => !routedLoadIds.has(l.id));
  const filterText = filter.trim().toLowerCase();
  const visibleUnroutedLoads = filterText
    ? unroutedLoads.filter((l) => [l.reference, l.origin, l.destination].some((f) => f.toLowerCase().includes(filterText)))
    : unroutedLoads;

  const toggleLoad = (loadId: string) => {
    setSelectedLoadIds((prev) => (prev.includes(loadId) ? prev.filter((id) => id !== loadId) : [...prev, loadId]));
  };

  const handleCreate = async () => {
    if (selectedLoadIds.length === 0) return;
    setCreating(true);
    setError("");
    setLastResult(null);
    try {
      const result = await api.createRoute(selectedLoadIds);
      setLastResult(
        `Route ${result.route.reference} created.` +
        (result.autoAdvanced.length > 0 ? ` ${result.autoAdvanced.length} load(s) auto-advanced.` : "")
      );
      setSelectedLoadIds([]);
      refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Routes</h2>
      </div>
      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}
      {lastResult && <div className="card" style={{ marginBottom: 16 }}>{lastResult}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Create Route</h3>
        {unroutedLoads.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No unrouted loads available.</p>
        ) : (
          <>
            {unroutedLoads.length > 5 && (
              <div className="form-group">
                <input placeholder="Filter by reference, origin, or destination..." value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
            )}
            {visibleUnroutedLoads.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No unrouted loads match "{filter}".</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {visibleUnroutedLoads.map((l) => (
                  <label key={l.id} style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={selectedLoadIds.includes(l.id)} onChange={() => toggleLoad(l.id)} />
                    {l.reference} ({l.origin} to {l.destination})
                    <StatusChip status={l.currentStatus} />
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        <button
          className="btn btn-primary"
          style={{ width: "auto" }}
          disabled={selectedLoadIds.length === 0 || creating}
          onClick={handleCreate}
        >
          {creating ? "Creating..." : "Create Route"}
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Existing Routes</h3>
        {routes.length === 0 ? (
          <div className="empty-state">No routes yet.</div>
        ) : (
          routes.map((r) => (
            <div key={r.id} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600 }}>{r.reference}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                {r.stops.map((s) => (
                  <div key={s.loadId} style={{ fontSize: 13, cursor: "pointer" }} onClick={() => onSelectLoad(s.loadId)}>
                    {s.load.reference}
                    {s.load.currentStatus && (
                      <StatusChip status={s.load.currentStatus} style={{ marginLeft: 6 }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Compliance Workbench ────────────────────────────────
// FR-41/42: per-route review, Finalize tallies outcomes + HOS and reroutes
// any out-of-service load back to maintenance.

function ComplianceWorkbenchPage() {
  const [queue, setQueue] = useState<ComplianceQueueRoute[]>([]);
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
          <div key={route.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 16 }}>{route.reference}</span>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                {route.stops.length} load{route.stops.length === 1 ? "" : "s"}
              </span>
            </div>

            {route.stops.map(({ load }) => {
              const inspection = load.inspections[0];
              const outcome = inspection?.overrideOutcome || inspection?.overallOutcome;
              return (
                <div
                  key={load.id}
                  style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10, marginBottom: 10 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{load.reference}</span>
                    <StatusChip status={load.currentStatus} />
                    {outcome ? (
                      <span className={`eligibility-badge ${outcome === "pass" ? "eligible" : "ineligible"}`}>
                        DVIR: {outcome.replace(/_/g, " ")}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>No inspection recorded</span>
                    )}
                  </div>

                  <div style={{ fontSize: 13, marginTop: 4 }}>{load.origin} &rarr; {load.destination}</div>
                  <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                    {load.driver?.name || "Unassigned"}
                    {load.vehicle ? ` · Unit ${load.vehicle.unitNumber} · ${load.vehicle.plate}` : ""}
                  </div>

                  {inspection && inspection.defects.length > 0 && (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13 }}>
                      {inspection.defects.map((d) => (
                        <li key={d.id}>
                          {d.defectCategory.name}{" "}
                          <span style={{ color: "var(--color-text-secondary)" }}>
                            ({d.defectCategory.outcome.replace(/_/g, " ")})
                          </span>
                          {d.note ? `: ${d.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}

                  {inspection?.overrideReason && (
                    <div style={{ fontSize: 13, marginTop: 4, fontStyle: "italic" }}>
                      Overridden: {inspection.overrideReason}
                    </div>
                  )}
                </div>
              );
            })}

            <button className="btn btn-primary" style={{ width: "auto" }} disabled={busyId === route.id} onClick={() => finalize(route.id)}>
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
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.getAuditLog().then(setLogs).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty-state">Loading...</div>;

  const filterText = filter.trim().toLowerCase();
  const filteredLogs = filterText
    ? logs.filter((log) =>
        [log.load.reference, log.fromStatus.name, log.toStatus.name, log.actor.name]
          .some((field) => field?.toLowerCase().includes(filterText))
      )
    : logs;

  return (
    <div>
      <div className="page-header">
        <h2>Audit History</h2>
      </div>
      {logs.length > 0 && (
        <div className="form-group">
          <input
            placeholder="Filter by load reference, status, or actor..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      <div className="card">
        {logs.length === 0 ? (
          <div className="empty-state">No audit entries yet.</div>
        ) : filteredLogs.length === 0 ? (
          <div className="empty-state">No entries match "{filter}".</div>
        ) : (
          filteredLogs.map((log) => (
            <div className="audit-row" key={log.id}>
              <span style={{ fontWeight: 600 }}>{log.load.reference}</span>
              <StatusChip status={log.fromStatus} />
              <span className="arrow">{log.reverted ? "←" : "→"}</span>
              <StatusChip status={log.toStatus} />
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

// ─── DateTime Field ───────────────────────────────────────
// A native date picker paired with two custom scrollable dropdowns for
// hour and minute. Native <select> popups render however the OS wants
// (often the full option list, no capped/scrollable viewport) and native
// <input type="time"> has inconsistent segment-editing UX across browsers.
// ScrollableDropdown below shows a handful of rows at a time with the rest
// reachable by scrolling, the same way most modern time pickers behave.
// Value/onChange still use the same "YYYY-MM-DDTHH:mm" shape
// datetime-local used, so callers don't change.

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, m) => String(m * 5).padStart(2, "0"));

function ScrollableDropdown({
  value, options, onChange, disabled, ariaLabel, placeholder,
}: { value: string; options: string[]; onChange: (value: string) => void; disabled?: boolean; ariaLabel: string; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="scrollable-dropdown">
      <button
        type="button"
        className="scrollable-dropdown-trigger"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {value || placeholder}
      </button>
      {open && (
        <div className="scrollable-dropdown-panel" role="listbox">
          {options.map((opt) => (
            <div
              key={opt}
              role="option"
              aria-selected={opt === value}
              className={`scrollable-dropdown-option${opt === value ? " selected" : ""}`}
              onClick={() => { onChange(opt); setOpen(false); }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DateTimeField({ value, onChange, required }: { value: string; onChange: (value: string) => void; required?: boolean }) {
  const [datePart, timePart] = value ? value.split("T") : ["", ""];
  const [hour, minute] = timePart ? timePart.split(":") : ["", ""];

  const setDatePart = (d: string) => onChange(d ? `${d}T${timePart || "00:00"}` : "");
  const setHour = (h: string) => onChange(datePart ? `${datePart}T${h}:${minute || "00"}` : "");
  const setMinute = (m: string) => onChange(datePart ? `${datePart}T${hour || "00"}:${m}` : "");

  return (
    <div className="datetime-field">
      <input
        type="date"
        value={datePart}
        onChange={(e) => setDatePart(e.target.value)}
        required={required}
      />
      <span className="datetime-field-divider" />
      <ScrollableDropdown value={hour} options={HOURS} onChange={setHour} disabled={!datePart} ariaLabel="Hour" placeholder="HH" />
      <span className="datetime-field-colon">:</span>
      <ScrollableDropdown value={minute} options={MINUTES} onChange={setMinute} disabled={!datePart} ariaLabel="Minute" placeholder="MM" />
    </div>
  );
}

// ─── Driver HOS (Hours of Service) ───────────────────────
// RFP screen #7 (Driver View, simplified to HOS logging): a driver's own
// duty-status ledger and current availability, re-derived server-side by
// computeHosAvailability every time, never cached client-side.

const DUTY_STATUS_OPTIONS = [
  { value: "driving", label: "Driving" },
  { value: "on_duty_not_driving", label: "On Duty (not driving)" },
  { value: "off_duty", label: "Off Duty" },
  { value: "sleeper_berth", label: "Sleeper Berth" },
];

function DriverHosPage({ driverId }: { driverId: string }) {
  const [entries, setEntries] = useState<DutyStatusEntry[]>([]);
  const [availability, setAvailability] = useState<{ availableDriveHours: number; availableOnDutyHours: number; drivingHoursUsed: number; onDutyHoursUsed: number } | null>(null);
  const [dutyStatus, setDutyStatus] = useState("driving");
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    api.getDutyStatusEntries(driverId).then(setEntries).catch(() => {});
    api.getDriverAvailability(driverId).then(setAvailability).catch(() => setAvailability(null)).finally(() => setLoading(false));
  }, [driverId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startedAt) return;
    setSubmitting(true);
    setError("");
    try {
      await api.logDutyStatus({
        driverId,
        dutyStatus,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: endedAt ? new Date(endedAt).toISOString() : undefined,
      });
      setStartedAt("");
      setEndedAt("");
      refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>My Hours of Service</h2>
      </div>
      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      {availability && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 16 }}>Current Availability</h3>
          <div className="detail-grid">
            <div className="detail-field">
              <div className="label">Available Drive Hours</div>
              <div className="value">{availability.availableDriveHours.toFixed(1)}h</div>
            </div>
            <div className="detail-field">
              <div className="label">Available On-Duty Hours</div>
              <div className="value">{availability.availableOnDutyHours.toFixed(1)}h</div>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Log Duty Status</h3>
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="form-group" style={{ minWidth: 160, marginBottom: 0 }}>
            <label>Status</label>
            <select value={dutyStatus} onChange={(e) => setDutyStatus(e.target.value)}>
              {DUTY_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Started At</label>
            <DateTimeField value={startedAt} onChange={setStartedAt} required />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Ended At (optional)</label>
            <DateTimeField value={endedAt} onChange={setEndedAt} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "auto" }}>
            {submitting ? "Logging..." : "Log Entry"}
          </button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Entry History</h3>
        {entries.length === 0 ? (
          <div className="empty-state">No entries logged yet.</div>
        ) : (
          entries.map((entry) => (
            <div className="audit-row" key={entry.id}>
              <span>{DUTY_STATUS_OPTIONS.find((o) => o.value === entry.dutyStatus)?.label || entry.dutyStatus}</span>
              <span className="time">
                {new Date(entry.startedAt).toLocaleString()} to {entry.endedAt ? new Date(entry.endedAt).toLocaleString() : "ongoing"}
              </span>
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
  onSubmitDvir: () => void;
}

function LoadDetail({ loadId, onBack, user, onSubmitDvir }: LoadDetailProps) {
  const [load, setLoad] = useState<LoadType | null>(null);
  const [statuses, setStatuses] = useState<DispatchStatus[]>([]);
  const [transitions, setTransitions] = useState<DispatchTransition[]>([]);
  const [targetStatus, setTargetStatus] = useState("");
  const [inspections, setInspections] = useState<Inspection[]>([]);
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
    // Fetched separately so a driver whose row scoping returns nothing here
    // still gets the rest of the page.
    api.getInspections(loadId).then(setInspections).catch(() => setInspections([]));
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
          <h2>Load Details: {load.reference}</h2>
          <StatusChip status={load.currentStatus} />
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

      {load.driver && load.vehicle && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 16 }}>DVIR (Driver Vehicle Inspection Report)</h3>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 12 }}>
            Submitting a pre-trip or post-trip inspection computes an outcome from any defects found and
            auto-routes this load's status accordingly.
          </p>
          <button className="btn btn-primary" style={{ width: "auto" }} onClick={onSubmitDvir}>
            Submit DVIR
          </button>

          {inspections.length > 0 && (
            <div style={{ marginTop: 16, borderTop: "1px solid var(--color-border)", paddingTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Inspection history</div>
              {inspections.map((insp) => (
                <div key={insp.id} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--color-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {insp.type === "pre_trip" ? "Pre-trip" : "Post-trip"}
                    </span>
                    <span className={`eligibility-badge ${insp.overallOutcome === "pass" ? "eligible" : "ineligible"}`}>
                      {(insp.overrideOutcome || insp.overallOutcome || "").replace(/_/g, " ")}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                      {insp.driver.name} &middot; unit {insp.vehicle.unitNumber}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--color-text-secondary)" }}>
                      {new Date(insp.submittedAt).toLocaleString()}
                    </span>
                  </div>
                  {insp.defects.length > 0 ? (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13 }}>
                      {insp.defects.map((d) => (
                        <li key={d.id}>
                          {d.defectCategory.name}{" "}
                          <span style={{ color: "var(--color-text-secondary)" }}>
                            ({d.defectCategory.outcome.replace(/_/g, " ")})
                          </span>
                          {d.note ? `: ${d.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 4 }}>
                      No defects recorded.
                    </div>
                  )}
                  {insp.overrideReason && (
                    <div style={{ fontSize: 13, marginTop: 4, fontStyle: "italic" }}>
                      Overridden: {insp.overrideReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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
              <StatusChip status={log.fromStatus} />
              <span className="arrow">{log.reverted ? "←" : "→"}</span>
              <StatusChip status={log.toStatus} />
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
                  DVIR routed this transition{log.capturedData.inspection.overrideOutcome ? ` (overridden: ${log.capturedData.inspection.overrideOutcome}, ${log.capturedData.inspection.overrideReason})` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DVIR Submission ──────────────────────────────────────
// FR-28: defect checklist, pre/post-trip type, optional override with a
// mandatory reason. Submitting computes the outcome and auto-routes the
// load's status in one call.

function DvirSubmitPage({ loadId, onDone, onBack }: { loadId: string; onDone: () => void; onBack: () => void }) {
  const [load, setLoad] = useState<LoadType | null>(null);
  const [categories, setCategories] = useState<DefectCategory[]>([]);
  const [statuses, setStatuses] = useState<DispatchStatus[]>([]);
  const [type, setType] = useState<"pre_trip" | "post_trip">("pre_trip");
  const [selectedDefects, setSelectedDefects] = useState<Record<string, string>>({});
  const [odometerReading, setOdometerReading] = useState("");
  const [useOverride, setUseOverride] = useState(false);
  const [overrideOutcome, setOverrideOutcome] = useState("minor_defect");
  const [overrideReason, setOverrideReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ inspection: { overallOutcome: string }; advance: { load: { id: string; currentStatusId: string } } } | null>(null);

  useEffect(() => {
    Promise.all([api.getLoad(loadId), api.getDefectCategories(), api.getStatuses()])
      .then(([l, c, s]) => { setLoad(l); setCategories(c); setStatuses(s); })
      .finally(() => setLoading(false));
  }, [loadId]);

  const toggleDefect = (categoryId: string) => {
    setSelectedDefects((prev) => {
      const next = { ...prev };
      if (categoryId in next) delete next[categoryId];
      else next[categoryId] = "";
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!load?.driver || !load?.vehicle) return;
    setSubmitting(true);
    setError("");
    try {
      const submitted = await api.submitInspection({
        loadId,
        vehicleId: load.vehicle.id,
        driverId: load.driver.id,
        type,
        odometerReading: odometerReading ? Number(odometerReading) : undefined,
        defectEntries: Object.entries(selectedDefects).map(([defectCategoryId, note]) => ({
          defectCategoryId,
          note: note || undefined,
        })),
        overrideOutcome: useOverride ? overrideOutcome : undefined,
        overrideReason: useOverride ? overrideReason : undefined,
      });
      setResult(submitted);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !load) return <div className="empty-state">Loading...</div>;

  if (result) {
    const resultStatus = statuses.find((s) => s.id === result.advance.load.currentStatusId);
    return (
      <div>
        <div className="back-link" onClick={onDone}>&larr; Back to Load</div>
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>DVIR Submitted</h2>
          <p>Computed outcome: <strong>{result.inspection.overallOutcome}</strong></p>
          {resultStatus && (
            <p>Load status is now: <StatusChip status={resultStatus} /></p>
          )}
          <button className="btn btn-primary" style={{ width: "auto", marginTop: 12 }} onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="back-link" onClick={onBack}>&larr; Back to Load</div>
      <div className="page-header">
        <h2>Submit DVIR: {load.reference}</h2>
      </div>
      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      <form onSubmit={handleSubmit} className="card">
        <div className="form-group">
          <label>Inspection Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as "pre_trip" | "post_trip")}>
            <option value="pre_trip">Pre-Trip</option>
            <option value="post_trip">Post-Trip</option>
          </select>
        </div>

        <div className="form-group">
          <label>Odometer Reading (optional)</label>
          <input type="number" value={odometerReading} onChange={(e) => setOdometerReading(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Defects Found</label>
          {categories.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>No defect categories configured. Leaving this blank submits a clean (pass) inspection.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {categories.map((c) => (
                <div key={c.id}>
                  <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={c.id in selectedDefects} onChange={() => toggleDefect(c.id)} />
                    {c.name} <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>({c.outcome})</span>
                  </label>
                  {c.id in selectedDefects && (
                    <input
                      placeholder="Note (optional)"
                      value={selectedDefects[c.id]}
                      onChange={(e) => setSelectedDefects((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      style={{ marginTop: 4, marginLeft: 24, width: "calc(100% - 24px)" }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="form-group">
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={useOverride} onChange={(e) => setUseOverride(e.target.checked)} />
            Override computed outcome
          </label>
          {useOverride && (
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <select value={overrideOutcome} onChange={(e) => setOverrideOutcome(e.target.value)} style={{ flex: 1 }}>
                <option value="pass">pass</option>
                <option value="minor_defect">minor_defect</option>
                <option value="out_of_service">out_of_service</option>
              </select>
              <input
                placeholder="Reason (required)"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                style={{ flex: 2 }}
                required={useOverride}
              />
            </div>
          )}
        </div>

        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "auto" }}>
          {submitting ? "Submitting..." : "Submit DVIR"}
        </button>
      </form>
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
              <option key={v.id} value={v.id}>{v.plate} ({v.make} {v.model})</option>
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
          {eligibility.eligible ? "Eligible" : `Ineligible: ${eligibility.reasonCode.replace(/_/g, " ")}`}
        </div>
      )}
    </form>
  );
}

// ─── Workflow Configuration ────────────────────────────────

const ALL_ROLES: UserRole[] = ["driver", "dispatcher", "maintenance_tech", "compliance_officer", "fleet_admin"];

// Flags decide which workbench column a status lands in, so renaming a
// status never breaks Dispatch/Maintenance/Compliance.
const STATUS_FLAGS: { key: keyof DispatchStatus; label: string; hint: string }[] = [
  { key: "isDefault", label: "Default (starting) status", hint: "New loads start here. Exactly one per company." },
  { key: "requiresEligibilityCheck", label: "Requires eligibility check", hint: "Advancing into this status runs the driver/vehicle/HOS eligibility gate." },
  { key: "isDispatchStatus", label: "Dispatch Board: Assigned column", hint: "Loads here show in the Dispatch Board's left column." },
  { key: "isInTransitStatus", label: "Dispatch Board: In Transit column", hint: "Loads here show in the Dispatch Board's right column." },
  { key: "isFlaggedStatus", label: "Maintenance: Flagged column", hint: "Loads here show in the Maintenance Workbench's left column." },
  { key: "isInRepairStatus", label: "Maintenance: In Repair column", hint: "Loads here show in the Maintenance Workbench's right column." },
  { key: "isComplianceReviewQueue", label: "Compliance review queue", hint: "Routes with a load here are eligible for compliance finalization." },
];

function WorkflowConfigPage() {
  const [statuses, setStatuses] = useState<DispatchStatus[]>([]);
  const [transitions, setTransitions] = useState<DispatchTransition[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [position, setPosition] = useState("0");
  const [color, setColor] = useState("#5b6270");
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
      await api.createStatus({ name, code, position: Number(position), color, roleVisibility, ...flags });
      setName("");
      setCode("");
      setPosition("0");
      setColor("#5b6270");
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
        Statuses and transitions define the dispatch flow as data, so changes here take effect with no code deploy.
        A status's flags decide which workbench column it appears in and whether entering it runs the eligibility
        check. Its role visibility decides which roles may advance or revert a load out of it. A transition's
        Default Target is where Advance goes with no explicit target; its Outcome Trigger auto-routes a load there
        when a DVIR inspection computes that outcome.
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
                <th>Color</th>
                <th>Role Visibility</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <tr key={s.id}>
                  <td><StatusChip status={s} /></td>
                  <td>{s.code}</td>
                  <td>{s.position}</td>
                  <td>
                    {s.color && (
                      <span style={{ display: "inline-block", width: 16, height: 16, borderRadius: 4, background: s.color, border: "1px solid var(--color-border)" }} />
                    )}
                  </td>
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
            <div className="form-group" style={{ width: 60, marginBottom: 0 }}>
              <label>Color</label>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 38, padding: 2 }} />
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
                  <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>{f.hint}</span>
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
      <Route path="/app/*" element={<AppLayout />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
