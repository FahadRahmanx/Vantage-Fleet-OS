import { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, Link, Navigate, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { api, setToken, getToken, User, Load, DispatchStatus, DispatchTransition, Load as LoadType, StatusLog, UserRole, DefectCategory, DutyStatusEntry, Inspection, ComplianceQueueRoute, Upload, UploadRow, UserAccount, CarrierCompany, Dashboard, WidgetData, LoadDocument, LoadDocumentType, Setting, Driver, Vehicle, HosRuleset, VehicleTypeClass, MaintenanceIntervalTemplate, FuelEstimate, VehicleTriageSummary, TriageFault, HelpArticle } from "./api";
import LandingPage from "./landing/LandingPage";
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend, Title } from "chart.js";
import { Pie, Bar, Doughnut, Line } from "react-chartjs-2";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend, Title);

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
function canManageUsers(user: User): boolean {
  return user.platformAdmin || user.role === "fleet_admin";
}
function canManageDashboards(user: User): boolean {
  return user.platformAdmin || user.role === "fleet_admin";
}
function canManageSettings(user: User): boolean {
  return user.platformAdmin;
}
function canManageFleetRoster(user: User): boolean {
  return user.platformAdmin || user.role === "fleet_admin";
}
function canBulkRevert(user: User): boolean {
  return user.platformAdmin || user.role === "fleet_admin";
}
function canTriageFaults(user: User): boolean {
  return user.platformAdmin || user.role === "maintenance_tech" || user.role === "fleet_admin";
}
function canManageHelpArticles(user: User): boolean {
  return user.platformAdmin || user.role === "fleet_admin";
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

type Page = { kind: string; loadId?: string; uploadId?: string };

// Two-way mapping between page state and the URL, so the sidebar/detail
// navigation that already happens via setPage() is visible and shareable
// in the address bar instead of everything staying on the bare /app path.
function pageToPath(page: Page): string {
  switch (page.kind) {
    case "list": return "/app/loads";
    case "create": return "/app/loads/new";
    case "detail": return `/app/loads/${page.loadId}`;
    case "dvir": return `/app/loads/${page.loadId}/dvir`;
    case "upload-detail": return `/app/uploads/${page.uploadId}`;
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
  if (parts[0] === "uploads" && parts.length === 2) {
    return { kind: "upload-detail", uploadId: parts[1] };
  }
  return { kind: parts[0] };
}

function AppLayout() {
  const [user, setUser] = useState<User | null>(null);
  const [myNavOrder, setMyNavOrder] = useState<string[] | null>(null);
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

  useEffect(() => {
    if (user && !user.platformAdmin) {
      api.getMyNavOrder().then(setMyNavOrder).catch(() => setMyNavOrder(null));
    }
  }, [user]);

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

  const impersonatorSessionRaw = localStorage.getItem("impersonatorSession");
  const impersonatorSession: { token: string; user: User } | null = impersonatorSessionRaw ? JSON.parse(impersonatorSessionRaw) : null;

  const exitImpersonation = () => {
    if (!impersonatorSession) return;
    setToken(impersonatorSession.token);
    localStorage.setItem("user", JSON.stringify(impersonatorSession.user));
    localStorage.removeItem("impersonatorSession");
    window.location.href = "/app";
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
      key: "uploads",
      label: "Bulk Import",
      active: page.kind === "uploads" || page.kind === "upload-detail",
      visible: canDispatchWrite(user),
      onClick: () => setPage({ kind: "uploads" }),
    },
    {
      key: "users",
      label: "Users",
      active: page.kind === "users",
      visible: canManageUsers(user),
      onClick: () => setPage({ kind: "users" }),
    },
    {
      key: "settings",
      label: "Settings",
      active: page.kind === "settings",
      visible: canManageSettings(user),
      onClick: () => setPage({ kind: "settings" }),
    },
    {
      key: "carriers",
      label: "Carrier Companies",
      active: page.kind === "carriers",
      visible: canManageFleetRoster(user),
      onClick: () => setPage({ kind: "carriers" }),
    },
    {
      key: "fleet-vehicles",
      label: "Vehicles",
      active: page.kind === "fleet-vehicles",
      visible: canManageFleetRoster(user),
      onClick: () => setPage({ kind: "fleet-vehicles" }),
    },
    {
      key: "fleet-drivers",
      label: "Drivers",
      active: page.kind === "fleet-drivers",
      visible: canManageFleetRoster(user),
      onClick: () => setPage({ kind: "fleet-drivers" }),
    },
    {
      key: "defect-categories",
      label: "Defect Categories",
      active: page.kind === "defect-categories",
      visible: canManageFleetRoster(user),
      onClick: () => setPage({ kind: "defect-categories" }),
    },
    {
      key: "vehicle-type-classes",
      label: "Vehicle Type Classes",
      active: page.kind === "vehicle-type-classes",
      visible: canManageFleetRoster(user),
      onClick: () => setPage({ kind: "vehicle-type-classes" }),
    },
    {
      key: "maintenance-interval-templates",
      label: "Maintenance Intervals",
      active: page.kind === "maintenance-interval-templates",
      visible: canManageFleetRoster(user),
      onClick: () => setPage({ kind: "maintenance-interval-templates" }),
    },
    {
      key: "notification-template",
      label: "Notification Template",
      active: page.kind === "notification-template",
      visible: canManageSettings(user),
      onClick: () => setPage({ kind: "notification-template" }),
    },
    {
      key: "compliance-summary-template",
      label: "Compliance Summary Template",
      active: page.kind === "compliance-summary-template",
      visible: canManageSettings(user),
      onClick: () => setPage({ kind: "compliance-summary-template" }),
    },
    {
      key: "fuel-analytics",
      label: "Fuel Analytics",
      active: page.kind === "fuel-analytics",
      visible: canManageFleetRoster(user),
      onClick: () => setPage({ kind: "fuel-analytics" }),
    },
    {
      key: "reports",
      label: "Reports",
      active: page.kind === "reports",
      visible: canManageFleetRoster(user),
      onClick: () => setPage({ kind: "reports" }),
    },
    {
      key: "dev-tools",
      label: "Dev Tools",
      active: page.kind === "dev-tools",
      visible: import.meta.env.DEV && user.platformAdmin,
      onClick: () => setPage({ kind: "dev-tools" }),
    },
    {
      key: "maintenance",
      label: "Maintenance",
      active: page.kind === "maintenance",
      visible: user.platformAdmin || user.role === "maintenance_tech" || user.role === "fleet_admin",
      onClick: () => setPage({ kind: "maintenance" }),
    },
    {
      key: "triage",
      label: "Triage",
      active: page.kind === "triage",
      visible: canTriageFaults(user),
      onClick: () => setPage({ kind: "triage" }),
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
      key: "help",
      label: "Help",
      active: page.kind === "help",
      visible: true,
      onClick: () => setPage({ kind: "help" }),
    },
    {
      key: "help-admin",
      label: "Help Articles",
      active: page.kind === "help-admin",
      visible: canManageHelpArticles(user),
      onClick: () => setPage({ kind: "help-admin" }),
    },
    {
      key: "workflow-config",
      label: "Workflow Config",
      active: page.kind === "workflow-config",
      visible: canConfigureWorkflow(user),
      onClick: () => setPage({ kind: "workflow-config" }),
    },
    {
      key: "nav-builder",
      label: "Navigation Builder",
      active: page.kind === "nav-builder",
      visible: user.platformAdmin,
      onClick: () => setPage({ kind: "nav-builder" }),
    },
  ];

  const resolvedNavItems = navItems.filter((item) => item.visible);
  const NAV_REGISTRY_KEYS = new Set(["dashboard", "loads", "audit", "help", "dispatch-board", "routes", "uploads", "users", "carriers", "fleet-vehicles", "fleet-drivers", "defect-categories", "vehicle-type-classes", "maintenance-interval-templates", "fuel-analytics", "reports", "maintenance", "triage", "compliance", "help-admin", "workflow-config"]);
  const finalNavItems = !user.platformAdmin && myNavOrder
    ? [
        ...myNavOrder.map((key) => resolvedNavItems.find((item) => item.key === key)).filter((item): item is typeof resolvedNavItems[number] => !!item),
        ...resolvedNavItems.filter((item) => !NAV_REGISTRY_KEYS.has(item.key)),
      ]
    : resolvedNavItems;

  return (
    <div className="app-shell">
      {impersonatorSession && (
        <div style={{ background: "#b91c1c", color: "#fff", textAlign: "center", padding: "6px 12px", fontSize: 13, display: "flex", justifyContent: "center", alignItems: "center", gap: 12 }}>
          <span>Impersonating {user.name} ({user.role})</span>
          <button type="button" style={{ padding: "2px 10px", background: "transparent", color: "#fff", border: "1px solid rgba(255,255,255,0.6)", borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: 13 }} onClick={exitImpersonation}>Exit</button>
        </div>
      )}
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
          {finalNavItems.map((item) => (
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
            <DashboardPage user={user} />
          )}
          {page.kind === "list" && (
            <LoadList
              onSelect={(id) => setPage({ kind: "detail", loadId: id })}
              onNew={() => setPage({ kind: "create" })}
              canCreate={canDispatchWrite(user)}
              user={user}
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
          {page.kind === "uploads" && (
            <UploadsPage onSelectUpload={(id) => setPage({ kind: "upload-detail", uploadId: id })} />
          )}
          {page.kind === "upload-detail" && page.uploadId && (
            <UploadDetailPage uploadId={page.uploadId} onBack={() => setPage({ kind: "uploads" })} />
          )}
          {page.kind === "users" && <UsersPage user={user} />}
          {page.kind === "settings" && <SettingsPage />}
          {page.kind === "carriers" && <CarrierCompaniesPage />}
          {page.kind === "fleet-vehicles" && <FleetVehiclesPage />}
          {page.kind === "fleet-drivers" && <FleetDriversPage />}
          {page.kind === "defect-categories" && <DefectCategoriesPage />}
          {page.kind === "vehicle-type-classes" && <VehicleTypeClassesPage />}
          {page.kind === "maintenance-interval-templates" && <MaintenanceIntervalTemplatesPage />}
          {page.kind === "notification-template" && <NotificationTemplatePage />}
          {page.kind === "compliance-summary-template" && <ComplianceSummaryTemplatePage />}
          {page.kind === "nav-builder" && <NavBuilderPage />}
          {page.kind === "fuel-analytics" && <FuelAnalyticsPage />}
          {page.kind === "reports" && <ReportsPlaceholderPage />}
          {page.kind === "dev-tools" && import.meta.env.DEV && <DevToolsPage />}
          {page.kind === "maintenance" && (
            <MaintenanceWorkbenchPage onSelect={(id) => setPage({ kind: "detail", loadId: id })} />
          )}
          {page.kind === "triage" && <TriageWorkbenchPage user={user} />}
          {page.kind === "compliance" && <ComplianceWorkbenchPage />}
          {page.kind === "my-hos" && user.driverId && <DriverHosPage driverId={user.driverId} />}
          {page.kind === "audit" && <AuditHistoryPage />}
          {page.kind === "help" && <HelpCentrePage />}
          {page.kind === "help-admin" && <HelpArticlesAdminPage />}
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
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { token, user } = await api.login(email, password, rememberMe);
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
        <div className="form-group" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" id="remember-me" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
          <label htmlFor="remember-me" style={{ margin: 0 }}>Remember me</label>
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <Link to="/forgot-password" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Forgot password?</Link>
        </div>
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

function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";

  const [preview, setPreview] = useState<{ name: string; email: string; role: string } | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Missing invite token.");
      setLoading(false);
      return;
    }
    api.getInvitePreview(token)
      .then(setPreview)
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const { token: authToken, user } = await api.acceptInvite(token, password);
      setToken(authToken);
      localStorage.setItem("user", JSON.stringify(user));
      navigate("/app");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="login-page"><div className="login-card">Loading...</div></div>;

  return (
    <div className="login-page">
      <div className="login-card">
        <Link to="/" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <img src="/logo.svg" alt="" style={{ width: 40, height: 40 }} />
          <h1>Vantage Fleet OS</h1>
        </Link>
        {!preview ? (
          <div className="error">{error || "Invalid or expired invite link."}</div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="subtitle">Welcome, {preview.name} ({preview.role}) &mdash; set a password to activate {preview.email}</p>
            {error && <div className="error">{error}</div>}
            <div className="form-group">
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? "Activating..." : "Activate Account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.forgotPassword(email);
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <Link to="/" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <img src="/logo.svg" alt="" style={{ width: 40, height: 40 }} />
          <h1>Vantage Fleet OS</h1>
        </Link>
        {submitted ? (
          <p className="subtitle">If an account exists for {email}, a reset link has been sent.</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="subtitle">Enter your email and we'll send a password reset link.</p>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
          </form>
        )}
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <Link to="/login" style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>&larr; Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <Link to="/" style={{ textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <img src="/logo.svg" alt="" style={{ width: 40, height: 40 }} />
          <h1>Vantage Fleet OS</h1>
        </Link>
        {!token ? (
          <div className="error">Missing reset token.</div>
        ) : done ? (
          <>
            <p className="subtitle">Password updated.</p>
            <button className="btn btn-primary" onClick={() => navigate("/login")}>Sign In</button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="subtitle">Choose a new password.</p>
            {error && <div className="error">{error}</div>}
            <div className="form-group">
              <label>New Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? "Resetting..." : "Reset Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────
// KPI landing page (RFP screen #2, deliberately a metrics summary rather
// than a single workspace) — the counts are all derived from data every
// role already has read access to, not a new backend endpoint. A driver's
// getLoads() is already row-scoped to their own loads server-side, so
// their card totals naturally reflect only their own work.

const WIDGET_CATALOGUE: { key: string; label: string; chartType: "kpi" | "pie" | "bar" | "donut" | "line" }[] = [
  { key: "active_loads", label: "Active Loads", chartType: "kpi" },
  { key: "total_loads", label: "Total Loads", chartType: "kpi" },
  { key: "loads_this_month", label: "Loads This Month", chartType: "kpi" },
  { key: "loads_by_status", label: "Loads by Status", chartType: "pie" },
  { key: "loads_by_carrier", label: "Loads by Carrier", chartType: "bar" },
  { key: "loads_by_vehicle_type", label: "Loads by Vehicle Type", chartType: "donut" },
  { key: "loads_per_month", label: "Loads per Month", chartType: "line" },
];

const CHART_COLORS = ["#00884b", "#856404", "#004085", "#ba1a1a", "#a15c07", "#666666", "#5b6270", "#0d6efd"];

function WidgetRenderer({ widgetKey, data }: { widgetKey: string; data: WidgetData | undefined }) {
  const def = WIDGET_CATALOGUE.find((w) => w.key === widgetKey);
  if (!def) return null;

  if (def.chartType === "kpi") {
    return (
      <div className="card" style={{ height: 280, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: 32, fontWeight: 700, lineHeight: 1 }}>{data?.value ?? 0}</div>
        <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 6 }}>{def.label}</div>
      </div>
    );
  }

  if (!data?.labels || !data.values) return null;

  const chartData = {
    labels: data.labels,
    datasets: [{ label: def.label, data: data.values, backgroundColor: CHART_COLORS }],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: def.label },
      legend: { display: def.chartType === "pie" || def.chartType === "donut" },
    },
  };

  return (
    <div className="card" style={{ height: 280, display: "flex", flexDirection: "column" }}>
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {def.chartType === "pie" && <Pie data={chartData} options={options} />}
        {def.chartType === "donut" && <Doughnut data={chartData} options={options} />}
        {def.chartType === "bar" && <Bar data={chartData} options={options} />}
        {def.chartType === "line" && <Line data={chartData} options={options} />}
      </div>
    </div>
  );
}

function DashboardPage({ user }: { user: User }) {
  const [dashboards, setDashboards] = useState<{ personal: Dashboard; role: Dashboard; company: Dashboard } | null>(null);
  const [activeScope, setActiveScope] = useState<"personal" | "role" | "company">("personal");
  const [roleOverride, setRoleOverride] = useState<UserRole>(user.role);
  const [roleOverrideDashboard, setRoleOverrideDashboard] = useState<Dashboard | null>(null);
  const [data, setData] = useState<Record<string, WidgetData> | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftKeys, setDraftKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getDashboards().then(setDashboards);
  }, []);

  useEffect(() => {
    if (activeScope !== "role" || roleOverride === user.role) {
      setRoleOverrideDashboard(null);
      return;
    }
    api.getRoleDashboard(roleOverride).then(setRoleOverrideDashboard);
  }, [activeScope, roleOverride, user.role]);

  const active: Dashboard | null =
    activeScope === "personal"
      ? dashboards?.personal ?? null
      : activeScope === "company"
      ? dashboards?.company ?? null
      : roleOverride === user.role
      ? dashboards?.role ?? null
      : roleOverrideDashboard;

  useEffect(() => {
    if (!active) return;
    setData(null);
    api.getDashboardData(active.id).then(setData);
    setDraftKeys(active.widgetKeys);
    setEditing(false);
  }, [active?.id]);

  if (!dashboards || !active) return <div className="empty-state">Loading...</div>;

  const isOwnRoleTab = activeScope === "role" && roleOverride === user.role;
  const canEditActive = activeScope === "personal" || canManageDashboards(user);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.updateDashboard(active.id, draftKeys);
      if (activeScope === "personal") setDashboards((d) => (d ? { ...d, personal: updated } : d));
      else if (activeScope === "company") setDashboards((d) => (d ? { ...d, company: updated } : d));
      else if (isOwnRoleTab) setDashboards((d) => (d ? { ...d, role: updated } : d));
      else setRoleOverrideDashboard(updated);
      setEditing(false);
      setData(await api.getDashboardData(active.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
        {canEditActive && (
          <button type="button" className="btn btn-secondary" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </button>
        )}
      </div>

      <div className="form-group">
        {(["personal", "role", "company"] as const).map((scope) => (
          <button
            key={scope}
            type="button"
            className={activeScope === scope ? "btn btn-primary" : "btn btn-secondary"}
            style={{ marginRight: 8 }}
            onClick={() => setActiveScope(scope)}
          >
            {scope === "personal" ? "My Dashboard" : scope === "role" ? "Team" : "Company"}
          </button>
        ))}
        {activeScope === "role" && canManageDashboards(user) && (
          <select value={roleOverride} onChange={(e) => setRoleOverride(e.target.value as UserRole)} style={{ marginLeft: 8 }}>
            <option value="dispatcher">Dispatcher</option>
            <option value="fleet_admin">Fleet Admin</option>
            <option value="maintenance_tech">Maintenance Technician</option>
            <option value="compliance_officer">Compliance Officer</option>
            <option value="driver">Driver</option>
          </select>
        )}
      </div>

      {editing ? (
        <div className="card">
          {WIDGET_CATALOGUE.map((w) => (
            <div key={w.key} className="form-group">
              <label>
                <input
                  type="checkbox"
                  checked={draftKeys.includes(w.key)}
                  onChange={(e) =>
                    setDraftKeys((keys) => (e.target.checked ? [...keys, w.key] : keys.filter((k) => k !== w.key)))
                  }
                />{" "}
                {w.label}
              </label>
            </div>
          ))}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, alignItems: "stretch" }}>
          {active.widgetKeys.length === 0 ? (
            <div className="empty-state">No widgets enabled.{canEditActive ? " Click Edit to add some." : ""}</div>
          ) : (
            active.widgetKeys.map((key) => <WidgetRenderer key={key} widgetKey={key} data={data?.[key]} />)
          )}
        </div>
      )}
    </div>
  );
}

// ─── Load List ────────────────────────────────────────────

// FR-18: registry of every column the load list can show. The default set
// (below) matches the table's original fixed columns exactly, so a status
// with no configured loadListColumns renders identically to before.
const LOAD_LIST_COLUMNS: { key: string; label: string; render: (load: Load) => React.ReactNode }[] = [
  { key: "reference", label: "Reference", render: (l) => l.reference },
  { key: "origin", label: "Origin", render: (l) => l.origin },
  { key: "destination", label: "Destination", render: (l) => l.destination },
  { key: "status", label: "Status", render: (l) => <StatusChip status={l.currentStatus} /> },
  { key: "driver", label: "Driver", render: (l) => l.driver?.name || "—" },
  { key: "vehicle", label: "Vehicle", render: (l) => l.vehicle?.plate || "—" },
  { key: "docs", label: "Docs", render: (l) => (l._count && l._count.documents > 0 ? `📎 ${l._count.documents}` : "—") },
  { key: "route", label: "Route", render: (l) => l.routeStop?.route.reference || "—" },
  { key: "createdAt", label: "Created", render: (l) => new Date(l.createdAt).toLocaleDateString() },
];
const DEFAULT_LOAD_LIST_COLUMN_KEYS = ["reference", "origin", "destination", "status", "driver", "vehicle", "docs"];
const LOAD_LIST_PAGE_SIZE = 10;
type LoadSortKey = "reference" | "origin" | "destination" | "status" | "driver";

function LoadList({ onSelect, onNew, canCreate, user }: { onSelect: (id: string) => void; onNew: () => void; canCreate: boolean; user: User }) {
  const [loads, setLoads] = useState<Load[]>([]);
  const [statuses, setStatuses] = useState<DispatchStatus[]>([]);
  const [transitions, setTransitions] = useState<DispatchTransition[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [statusFilterId, setStatusFilterId] = useState("");
  const [routeFilter, setRouteFilter] = useState("");
  const [uploadFilterId, setUploadFilterId] = useState("");
  const [sort, setSort] = useState<{ key: LoadSortKey; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const [groupByRoute, setGroupByRoute] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [advanceModalLoad, setAdvanceModalLoad] = useState<Load | null>(null);
  const [bulkTargetStatusId, setBulkTargetStatusId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResultSummary, setBulkResultSummary] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api.getLoads(), api.getStatuses(), api.getTransitions(), api.getUploads()]).then(([l, s, t, u]) => {
      setLoads(l);
      setStatuses(s);
      setTransitions(t);
      setUploads(u);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setPage(1); }, [filter, statusFilterId, routeFilter, uploadFilterId, groupByRoute]);

  // Batch filter is resolved client-side from each upload's createdLoadIds
  // rather than a second network round-trip per filter change.
  const loadIdToUploadId = new Map<string, string>();
  for (const u of uploads) for (const id of u.createdLoadIds) loadIdToUploadId.set(id, u.id);

  const routeOptions = Array.from(new Set(loads.map((l) => l.routeStop?.route.reference).filter((r): r is string => !!r))).sort();

  const filterText = filter.trim().toLowerCase();
  let filteredLoads = loads;
  if (statusFilterId) filteredLoads = filteredLoads.filter((l) => l.currentStatus.id === statusFilterId);
  if (routeFilter === "__none__") filteredLoads = filteredLoads.filter((l) => !l.routeStop);
  else if (routeFilter) filteredLoads = filteredLoads.filter((l) => l.routeStop?.route.reference === routeFilter);
  if (uploadFilterId) filteredLoads = filteredLoads.filter((l) => loadIdToUploadId.get(l.id) === uploadFilterId);
  if (filterText) {
    filteredLoads = filteredLoads.filter((l) =>
      [l.reference, l.origin, l.destination, l.currentStatus.name, l.driver?.name, l.vehicle?.plate]
        .some((field) => field?.toLowerCase().includes(filterText))
    );
  }

  const sortValue = (l: Load, key: LoadSortKey) => {
    switch (key) {
      case "reference": return l.reference;
      case "origin": return l.origin;
      case "destination": return l.destination;
      case "status": return l.currentStatus.name;
      case "driver": return l.driver?.name || "";
    }
  };
  const sortedLoads = sort && !groupByRoute
    ? [...filteredLoads].sort((a, b) => sortValue(a, sort.key).localeCompare(sortValue(b, sort.key)) * sort.dir)
    : filteredLoads;

  const toggleSort = (key: LoadSortKey) => {
    setSort((prev) => (prev?.key === key ? (prev.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  };

  const totalPages = Math.max(1, Math.ceil(sortedLoads.length / LOAD_LIST_PAGE_SIZE));
  const pagedLoads = sortedLoads.slice((page - 1) * LOAD_LIST_PAGE_SIZE, page * LOAD_LIST_PAGE_SIZE);

  // Per-status configurable columns only make sense once the list is
  // narrowed to one status — a flat multi-status table can't show a
  // different column set per row, so "All statuses" always uses the
  // default set.
  const singleStatus = statusFilterId ? statuses.find((s) => s.id === statusFilterId) : undefined;
  const activeColumnKeys = singleStatus && singleStatus.loadListColumns.length > 0 ? singleStatus.loadListColumns : DEFAULT_LOAD_LIST_COLUMN_KEYS;
  const activeColumns = LOAD_LIST_COLUMNS.filter((c) => activeColumnKeys.includes(c.key));

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Only affects the current page's rows — individually toggled selections
  // on other pages are untouched, which is what makes "selection persisted
  // across pages" true without any special-casing.
  const toggleSelectAllOnPage = (rows: Load[]) => {
    setSelectedIds((prev) => {
      const allSelected = rows.length > 0 && rows.every((l) => prev.has(l.id));
      const next = new Set(prev);
      for (const l of rows) {
        if (allSelected) next.delete(l.id); else next.add(l.id);
      }
      return next;
    });
  };

  const runBulkAdvance = async (ids: string[]) => {
    setBulkBusy(true);
    setBulkResultSummary(null);
    try {
      const { results } = await api.bulkAdvance(ids);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.length - succeeded;
      setBulkResultSummary(`Advanced ${succeeded} of ${results.length}.` + (failed > 0 ? ` ${failed} failed: ${results.filter((r) => !r.success).map((r) => r.error).join("; ")}` : ""));
      setSelectedIds((prev) => { const next = new Set(prev); for (const id of ids) next.delete(id); return next; });
      refresh();
    } finally {
      setBulkBusy(false);
    }
  };

  const runBulkRevert = async () => {
    if (!bulkTargetStatusId) return;
    setBulkBusy(true);
    setBulkResultSummary(null);
    try {
      const { results } = await api.bulkRevert(Array.from(selectedIds), bulkTargetStatusId);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.length - succeeded;
      setBulkResultSummary(`Reverted ${succeeded} of ${results.length}.` + (failed > 0 ? ` ${failed} failed: ${results.filter((r) => !r.success).map((r) => r.error).join("; ")}` : ""));
      setSelectedIds(new Set());
      setBulkTargetStatusId("");
      refresh();
    } finally {
      setBulkBusy(false);
    }
  };

  const sortIndicator = (key: LoadSortKey) => (sort?.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  const renderRow = (load: Load) => (
    <tr key={load.id} onClick={() => onSelect(load.id)}>
      <td onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selectedIds.has(load.id)} onChange={() => toggleSelected(load.id)} />
      </td>
      {activeColumns.map((col) => <td key={col.key}>{col.render(load)}</td>)}
      <td onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-secondary" onClick={() => setAdvanceModalLoad(load)}>Advance</button>
      </td>
    </tr>
  );

  const tableHead = (rows: Load[]) => (
    <thead>
      <tr>
        <th>
          <input type="checkbox" checked={rows.length > 0 && rows.every((l) => selectedIds.has(l.id))} onChange={() => toggleSelectAllOnPage(rows)} />
        </th>
        {activeColumns.map((col) => {
          const sortable = ["reference", "origin", "destination", "status", "driver"].includes(col.key) && !groupByRoute;
          return (
            <th key={col.key} style={sortable ? { cursor: "pointer" } : undefined} onClick={sortable ? () => toggleSort(col.key as LoadSortKey) : undefined}>
              {col.label}{sortable ? sortIndicator(col.key as LoadSortKey) : ""}
            </th>
          );
        })}
        <th>Actions</th>
      </tr>
    </thead>
  );

  // Group-by-Route groups the already filtered+searched (but unpaginated,
  // unsorted — grouped order is by route, not a sortable column) set.
  const routeGroups = groupByRoute
    ? (() => {
        const groups = new Map<string, Load[]>();
        for (const l of filteredLoads) {
          const key = l.routeStop?.route.reference || "__none__";
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(l);
        }
        return Array.from(groups.entries()).sort(([a], [b]) => (a === "__none__" ? 1 : b === "__none__" ? -1 : a.localeCompare(b)));
      })()
    : [];

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
            <div className="filter-bar">
              <select value={statusFilterId} onChange={(e) => setStatusFilterId(e.target.value)}>
                <option value="">All statuses</option>
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={routeFilter} onChange={(e) => setRouteFilter(e.target.value)}>
                <option value="">All routes</option>
                <option value="__none__">Not on a route</option>
                {routeOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={uploadFilterId} onChange={(e) => setUploadFilterId(e.target.value)}>
                <option value="">All batches</option>
                {uploads.map((u) => <option key={u.id} value={u.id}>{u.fileName} ({new Date(u.createdAt).toLocaleDateString()})</option>)}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={groupByRoute} onChange={(e) => setGroupByRoute(e.target.checked)} />
                Group by Route
              </label>
            </div>
            {selectedIds.size > 0 && (
              <div className="card filter-bar" style={{ marginBottom: 12 }}>
                <span>{selectedIds.size} selected</span>
                <button className="btn btn-primary" style={{ width: "auto" }} disabled={bulkBusy} onClick={() => runBulkAdvance(Array.from(selectedIds))}>
                  {bulkBusy ? "Working..." : "Advance Selected"}
                </button>
                {canBulkRevert(user) && (
                  <>
                    <select value={bulkTargetStatusId} onChange={(e) => setBulkTargetStatusId(e.target.value)}>
                      <option value="">Revert to...</option>
                      {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button className="btn btn-secondary" disabled={bulkBusy || !bulkTargetStatusId} onClick={runBulkRevert}>
                      {bulkBusy ? "Working..." : "Revert Selected"}
                    </button>
                  </>
                )}
              </div>
            )}
            {bulkResultSummary && <div className="card" style={{ marginBottom: 12 }}>{bulkResultSummary}</div>}
            {filteredLoads.length === 0 ? (
              <div className="empty-state">No loads match the current filters.</div>
            ) : groupByRoute ? (
              routeGroups.map(([key, rows]) => (
                <div key={key} style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <h3 style={{ fontSize: 15 }}>{key === "__none__" ? "Not on a route" : key}</h3>
                    {key !== "__none__" && (
                      <button className="btn btn-secondary" disabled={bulkBusy} onClick={() => runBulkAdvance(rows.map((l) => l.id))}>
                        Batch Advance This Route
                      </button>
                    )}
                  </div>
                  <table>
                    {tableHead(rows)}
                    <tbody>{rows.map(renderRow)}</tbody>
                  </table>
                </div>
              ))
            ) : (
              <>
                <table>
                  {tableHead(pagedLoads)}
                  <tbody>{pagedLoads.map(renderRow)}</tbody>
                </table>
                {totalPages > 1 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                    <button className="btn btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
                    <span style={{ fontSize: 13 }}>Page {page} of {totalPages}</span>
                    <button className="btn btn-secondary" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      {advanceModalLoad && (
        <RecordAdvanceModal
          load={advanceModalLoad}
          allowedTransitions={transitions.filter((t) => t.fromStatus.id === advanceModalLoad.currentStatus.id).map((t) => t.toStatus)}
          onDone={() => { setAdvanceModalLoad(null); refresh(); }}
          onClose={() => setAdvanceModalLoad(null)}
        />
      )}
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

// ─── Shared Advance/Revert Modals ──────────────────────────
// FR-29: one modal used by the load list, load detail, Dispatch Board,
// and Maintenance Workbench, instead of each surface re-implementing
// advance/revert. Handles the plain-advance path only — outcome-driven
// DVIR routing stays on DvirSubmitPage (see spec's Out of scope).

function RecordAdvanceModal({
  load,
  allowedTransitions,
  onDone,
  onClose,
}: {
  load: LoadType;
  allowedTransitions: DispatchStatus[];
  onDone: () => void;
  onClose: () => void;
}) {
  const isFastPath = allowedTransitions.length === 1;
  const [targetStatusId, setTargetStatusId] = useState(isFastPath ? allowedTransitions[0].id : "");
  const [comment, setComment] = useState("");
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reasonCode: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const targetStatus = allowedTransitions.find((s) => s.id === targetStatusId);

  useEffect(() => {
    if (!targetStatus?.requiresEligibilityCheck || !load.driver || !load.vehicle) {
      setEligibility(null);
      return;
    }
    api.getDriverEligibility(load.driver.id, load.vehicle.id).then(setEligibility).catch(() => setEligibility(null));
  }, [targetStatus?.id, load.driver, load.vehicle]);

  const locked = !!targetStatus?.requiresEligibilityCheck && eligibility !== null && !eligibility.eligible;

  const handleSubmit = async () => {
    if (!targetStatusId || locked) return;
    setSubmitting(true);
    setError("");
    try {
      await api.advance(load.id, targetStatusId, comment || undefined);
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Advance {load.reference}</h3>
        {error && <div className="error">{error}</div>}

        {!isFastPath && (
          <div className="form-group">
            <label>Target Status</label>
            <select value={targetStatusId} onChange={(e) => setTargetStatusId(e.target.value)}>
              <option value="">Select...</option>
              {allowedTransitions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        {isFastPath && <p>Advance to <strong>{allowedTransitions[0].name}</strong>?</p>}

        {targetStatus?.requiresEligibilityCheck && eligibility && (
          <div className={`eligibility-badge ${eligibility.eligible ? "eligible" : "ineligible"}`} style={{ marginBottom: 12 }}>
            {eligibility.eligible ? "Eligible" : `Ineligible: ${eligibility.reasonCode.replace(/_/g, " ")}`}
          </div>
        )}

        <div className="form-group">
          <label>Comment (optional)</label>
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" disabled={!targetStatusId || locked || submitting} onClick={handleSubmit}>
            {submitting ? "Advancing..." : "Advance"}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function RecordRevertModal({
  load,
  allowedTargets,
  onDone,
  onClose,
}: {
  load: LoadType;
  allowedTargets: DispatchStatus[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [targetStatusId, setTargetStatusId] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!targetStatusId) return;
    setSubmitting(true);
    setError("");
    try {
      await api.revert(load.id, targetStatusId, comment || undefined);
      onDone();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3>Move {load.reference} Back</h3>
        {error && <div className="error">{error}</div>}

        <div className="form-group">
          <label>Target Status</label>
          <select value={targetStatusId} onChange={(e) => setTargetStatusId(e.target.value)}>
            <option value="">Select...</option>
            {allowedTargets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Comment (optional)</label>
          <input value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" disabled={!targetStatusId || submitting} onClick={handleSubmit}>
            {submitting ? "Reverting..." : "Move Back"}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Dispatch Board ───────────────────────────────────────
// FR-36/37: columns are resolved from DispatchStatus's isDispatchStatus /
// isInTransitStatus flags, never from status code or name. Renaming a
// status in Workflow Config must not break which column a load lands in.

function DispatchBoardPage({ onSelect }: { onSelect: (id: string) => void }) {
  const [loads, setLoads] = useState<Load[]>([]);
  const [transitions, setTransitions] = useState<DispatchTransition[]>([]);
  const [loading, setLoading] = useState(true);
  const [advanceModalLoad, setAdvanceModalLoad] = useState<Load | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api.getLoads(), api.getTransitions()]).then(([l, t]) => {
      setLoads(l);
      setTransitions(t);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <div className="empty-state">Loading...</div>;

  const dispatchColumn = loads.filter((l) => l.currentStatus.isDispatchStatus);
  const inTransitColumn = loads.filter((l) => l.currentStatus.isInTransitStatus);

  const renderCard = (load: Load) => (
    <LoadCard
      key={load.id}
      load={load}
      onSelect={() => onSelect(load.id)}
      action={{ label: "Advance", onClick: () => setAdvanceModalLoad(load) }}
    />
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
      {advanceModalLoad && (
        <RecordAdvanceModal
          load={advanceModalLoad}
          allowedTransitions={transitions.filter((t) => t.fromStatus.id === advanceModalLoad.currentStatus.id).map((t) => t.toStatus)}
          onDone={() => { setAdvanceModalLoad(null); refresh(); }}
          onClose={() => setAdvanceModalLoad(null)}
        />
      )}
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
  const [transitions, setTransitions] = useState<DispatchTransition[]>([]);
  const [loading, setLoading] = useState(true);
  const [advanceModalLoad, setAdvanceModalLoad] = useState<Load | null>(null);
  const [revertModalLoad, setRevertModalLoad] = useState<Load | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api.getLoads(), api.getStatuses(), api.getTransitions()]).then(([l, s, t]) => {
      setLoads(l);
      setStatuses(s);
      setTransitions(t);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <div className="empty-state">Loading...</div>;

  const flaggedColumn = loads.filter((l) => l.currentStatus.isFlaggedStatus);
  const inRepairColumn = loads.filter((l) => l.currentStatus.isInRepairStatus);
  const createdStatus = statuses.find((s) => s.isDefault);

  const renderCard = (load: Load, action: { label: string; onClick: () => void }) => (
    <LoadCard
      key={load.id}
      load={load}
      onSelect={() => onSelect(load.id)}
      action={action}
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
          {flaggedColumn.length === 0 ? <div className="empty-state">No loads</div> : flaggedColumn.map((l) => renderCard(l, { label: "Claim for Repair", onClick: () => setAdvanceModalLoad(l) }))}
        </div>
        <div style={{ flex: 1 }}>
          <h3>In Repair ({inRepairColumn.length})</h3>
          {inRepairColumn.length === 0 ? <div className="empty-state">No loads</div> : inRepairColumn.map((l) => renderCard(l, { label: "Complete Repair", onClick: () => setRevertModalLoad(l) }))}
        </div>
      </div>
      {advanceModalLoad && (
        <RecordAdvanceModal
          load={advanceModalLoad}
          allowedTransitions={transitions.filter((t) => t.fromStatus.id === advanceModalLoad.currentStatus.id).map((t) => t.toStatus)}
          onDone={() => { setAdvanceModalLoad(null); refresh(); }}
          onClose={() => setAdvanceModalLoad(null)}
        />
      )}
      {revertModalLoad && createdStatus && (
        <RecordRevertModal
          load={revertModalLoad}
          allowedTargets={[createdStatus]}
          onDone={() => { setRevertModalLoad(null); refresh(); }}
          onClose={() => setRevertModalLoad(null)}
        />
      )}
    </div>
  );
}

// ─── Rich Text Editor ───────────────────────────────────────
// FR-51: zero-new-dependency WYSIWYG using contentEditable + execCommand.
// Deliberately minimal — bold/italic, headings, lists, link, a simple
// table skeleton, and image upload. document.execCommand is deprecated
// but still broadly functional for this exact toolbar use case.

function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
    // Only sync from external value changes (e.g. switching which article is
    // being edited) — not on every keystroke, or the cursor would jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emitChange = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const exec = (command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    emitChange();
  };

  const insertLink = () => {
    const url = window.prompt("Link URL:");
    if (url) exec("createLink", url);
  };

  const insertTable = () => {
    exec("insertHTML", "<table><tr><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td></tr></table>");
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { url } = await api.uploadHelpArticleImage(file);
      exec("insertImage", url);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="rich-text-editor">
      <div className="rich-text-toolbar" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
        <button type="button" className="btn btn-secondary" onClick={() => exec("bold")}>Bold</button>
        <button type="button" className="btn btn-secondary" onClick={() => exec("italic")}>Italic</button>
        <button type="button" className="btn btn-secondary" onClick={() => exec("formatBlock", "H1")}>H1</button>
        <button type="button" className="btn btn-secondary" onClick={() => exec("formatBlock", "H2")}>H2</button>
        <button type="button" className="btn btn-secondary" onClick={() => exec("formatBlock", "H3")}>H3</button>
        <button type="button" className="btn btn-secondary" onClick={() => exec("insertUnorderedList")}>Bullet List</button>
        <button type="button" className="btn btn-secondary" onClick={() => exec("insertOrderedList")}>Numbered List</button>
        <button type="button" className="btn btn-secondary" onClick={insertLink}>Link</button>
        <button type="button" className="btn btn-secondary" onClick={insertTable}>Table</button>
        <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>Image</button>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageSelect} />
      </div>
      <div
        ref={editorRef}
        contentEditable
        className="rich-text-content"
        style={{ border: "1px solid var(--color-border)", borderRadius: 4, padding: 12, minHeight: 200 }}
        onInput={emitChange}
        onBlur={emitChange}
      />
    </div>
  );
}

// ─── Help Centre ────────────────────────────────────────────
// FR-51: instant client-side search over title/summary/keywords/content —
// fetched once, filtered on every keystroke with no server round-trip.

function HelpCentrePage() {
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    api.getHelpArticles().then(setArticles).finally(() => setLoading(false));
  }, []);

  const queryLower = query.trim().toLowerCase();
  const visibleArticles = queryLower
    ? articles.filter((a) =>
        [a.title, a.summary, ...a.keywords, a.content].some((field) => field.toLowerCase().includes(queryLower))
      )
    : articles;

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Help Centre</h2>
      </div>

      <div className="form-group">
        <input placeholder="Search help articles..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {visibleArticles.length === 0 ? (
        <div className="empty-state">No articles match "{query}".</div>
      ) : (
        visibleArticles.map((a) => (
          <div className="card" key={a.id} style={{ marginBottom: 8 }}>
            <div style={{ cursor: "pointer" }} onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}>
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              <div className="label">{a.summary}</div>
            </div>
            {expandedId === a.id && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--color-border)", paddingTop: 12 }} dangerouslySetInnerHTML={{ __html: a.content }} />
            )}
          </div>
        ))
      )}
    </div>
  );
}

function HelpArticlesAdminPage() {
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<HelpArticle> & { keywordsText?: string }>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newArticle, setNewArticle] = useState<Partial<HelpArticle> & { keywordsText?: string }>({ title: "", summary: "", content: "", keywordsText: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getHelpArticlesAdmin().then(setArticles).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const splitKeywords = (text: string) => text.split(",").map((k) => k.trim()).filter(Boolean);

  const startEdit = (a: HelpArticle) => {
    setEditingId(a.id);
    setEditDraft({ title: a.title, summary: a.summary, content: a.content, keywordsText: a.keywords.join(", "), published: a.published, order: a.order, visibleToCarriers: a.visibleToCarriers });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      const { keywordsText, ...rest } = editDraft;
      await api.updateHelpArticle(editingId, { ...rest, keywords: keywordsText !== undefined ? splitKeywords(keywordsText) : undefined });
      setEditingId(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newArticle.title?.trim() || !newArticle.summary?.trim() || !newArticle.content?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { keywordsText, ...rest } = newArticle;
      await api.createHelpArticle({ ...rest, keywords: keywordsText ? splitKeywords(keywordsText) : [] });
      setNewArticle({ title: "", summary: "", content: "", keywordsText: "" });
      setShowAddForm(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Help Articles</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Article"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {showAddForm && (
        <form className="card" onSubmit={addArticle} style={{ marginBottom: 16 }}>
          <div className="form-group">
            <label>Title</label>
            <input value={newArticle.title ?? ""} onChange={(e) => setNewArticle((a) => ({ ...a, title: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>Summary</label>
            <input value={newArticle.summary ?? ""} onChange={(e) => setNewArticle((a) => ({ ...a, summary: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>Keywords (comma-separated)</label>
            <input value={newArticle.keywordsText ?? ""} onChange={(e) => setNewArticle((a) => ({ ...a, keywordsText: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Content</label>
            <RichTextEditor value={newArticle.content ?? ""} onChange={(html) => setNewArticle((a) => ({ ...a, content: html }))} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
        </form>
      )}

      {articles.length === 0 ? (
        <div className="empty-state">No help articles yet.</div>
      ) : (
        articles.map((a) => (
          <div className="card" key={a.id} style={{ marginBottom: 8 }}>
            {editingId === a.id ? (
              <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={editDraft.title ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Title" />
                <input value={editDraft.summary ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, summary: e.target.value }))} placeholder="Summary" />
                <input value={editDraft.keywordsText ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, keywordsText: e.target.value }))} placeholder="Keywords (comma-separated)" />
                <RichTextEditor value={editDraft.content ?? ""} onChange={(html) => setEditDraft((d) => ({ ...d, content: html }))} />
                <input type="number" value={editDraft.order ?? 0} onChange={(e) => setEditDraft((d) => ({ ...d, order: Number(e.target.value) }))} placeholder="Order" />
                <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="checkbox" checked={editDraft.published ?? false} onChange={(e) => setEditDraft((d) => ({ ...d, published: e.target.checked }))} />
                  Published
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="checkbox" checked={editDraft.visibleToCarriers ?? false} onChange={(e) => setEditDraft((d) => ({ ...d, visibleToCarriers: e.target.checked }))} />
                  Visible to Carriers
                </label>
                <div>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={saveEdit}>Save</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="audit-row">
                <span style={{ fontWeight: 600 }}>{a.title}</span>
                <span className="label">{a.published ? "published" : "draft"}</span>
                <span className="label">order {a.order}</span>
                <span className="label">{a.visibleToCarriers ? "visible to carriers" : "internal only"}</span>
                <button type="button" className="btn btn-secondary" onClick={() => startEdit(a)}>Edit</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ─── Maintenance Triage Workbench ──────────────────────────
// FR-39: per-vehicle, per-fault triage — separate from the load-level
// flagged/in-repair flow above (FR-36). Operates on individual
// InspectionDefect rows, not Load status.

function TriageWorkbenchPage({ user }: { user: User }) {
  const [summaries, setSummaries] = useState<VehicleTriageSummary[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [mixedSeverities, setMixedSeverities] = useState(false);
  const [faults, setFaults] = useState<TriageFault[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyFaultId, setBusyFaultId] = useState<string | null>(null);
  const [confirmAllBusy, setConfirmAllBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshSummaries = useCallback(() => {
    api.getTriageVehicleSummaries().then((s) => {
      setSummaries(s);
      if (s.length > 0 && !selectedVehicleId) setSelectedVehicleId(s[0].vehicleId);
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { refreshSummaries(); }, [refreshSummaries]);

  const refreshFaults = useCallback(() => {
    if (!selectedVehicleId) { setFaults([]); return; }
    api.getVehicleFaults(selectedVehicleId).then((r) => {
      setMixedSeverities(r.mixedSeverities);
      setFaults(r.faults);
    });
  }, [selectedVehicleId]);

  useEffect(() => { refreshFaults(); }, [refreshFaults]);

  const refreshAll = () => {
    refreshSummaries();
    refreshFaults();
  };

  const confirmOne = async (defectId: string) => {
    setBusyFaultId(defectId);
    setError("");
    try {
      await api.confirmFault(defectId);
      refreshAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyFaultId(null);
    }
  };

  const confirmAll = async () => {
    if (!selectedVehicleId) return;
    setConfirmAllBusy(true);
    setError("");
    try {
      await api.confirmAllInRepair(selectedVehicleId);
      refreshAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirmAllBusy(false);
    }
  };

  const toggleOutOfService = async (defectId: string, value: boolean) => {
    setBusyFaultId(defectId);
    try {
      await api.setFaultOutOfService(defectId, value);
      refreshAll();
    } finally {
      setBusyFaultId(null);
    }
  };

  const overrideStatus = async (defectId: string, status: TriageFault["status"]) => {
    setBusyFaultId(defectId);
    try {
      await api.overrideFaultStatus(defectId, status);
      refreshAll();
    } finally {
      setBusyFaultId(null);
    }
  };

  const hasNotTriaged = faults.some((f) => f.status === "not_triaged");
  const confirmLabel = (status: TriageFault["status"]) => (status === "not_triaged" ? "Diagnose" : status === "in_repair" ? "Complete" : "Completed");

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Maintenance Triage</h2>
      </div>

      {error && <div className="error">{error}</div>}

      {summaries.length === 0 ? (
        <div className="empty-state">No vehicles with recorded faults yet.</div>
      ) : (
        <>
          <div className="form-group">
            <label>Vehicle</label>
            <select value={selectedVehicleId} onChange={(e) => setSelectedVehicleId(e.target.value)}>
              {summaries.map((s) => (
                <option key={s.vehicleId} value={s.vehicleId}>
                  {s.unitNumber} ({s.plate}) — Total {s.total} / Not-Triaged {s.notTriaged} / In-Repair {s.inRepair} / Completed {s.completed}
                </option>
              ))}
            </select>
          </div>

          {mixedSeverities && (
            <div className="card" style={{ marginBottom: 12 }}>
              Mixed severities among this vehicle's open faults.
            </div>
          )}

          <div className="card">
            <div style={{ marginBottom: 12 }}>
              <button className="btn btn-primary" disabled={hasNotTriaged || confirmAllBusy} onClick={confirmAll}>
                {confirmAllBusy ? "Working..." : "Confirm All"}
              </button>
              {hasNotTriaged && <span style={{ marginLeft: 8, fontSize: 13, color: "var(--color-text-secondary)" }}>Blocked while undiagnosed faults remain.</span>}
            </div>

            {faults.length === 0 ? (
              <div className="empty-state">No faults recorded for this vehicle.</div>
            ) : (
              faults.map((f) => (
                <div key={f.id} className="audit-row" style={{ flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 600 }}>{f.defectCategoryName}</span>
                  <span className="label">{f.outcome.replace(/_/g, " ")}</span>
                  <span className="label">{new Date(f.reportedDate).toLocaleDateString()}</span>
                  <span className="label">{f.status.replace(/_/g, " ")}</span>
                  <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={f.outOfServiceOverride}
                      disabled={busyFaultId === f.id}
                      onChange={(e) => toggleOutOfService(f.id, e.target.checked)}
                    />
                    Out of Service
                  </label>
                  {canComplianceWrite(user) && (
                    <select
                      value={f.status}
                      disabled={busyFaultId === f.id}
                      onChange={(e) => overrideStatus(f.id, e.target.value as TriageFault["status"])}
                    >
                      <option value="not_triaged">Not Triaged</option>
                      <option value="in_repair">In Repair</option>
                      <option value="completed">Completed</option>
                    </select>
                  )}
                  <button
                    className="btn btn-secondary"
                    disabled={f.status === "completed" || busyFaultId === f.id}
                    onClick={() => confirmOne(f.id)}
                  >
                    {busyFaultId === f.id ? "Working..." : confirmLabel(f.status)}
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
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
  const [advancingRouteId, setAdvancingRouteId] = useState<string | null>(null);
  const [routeAdvanceSummary, setRouteAdvanceSummary] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api.getRoutes(), api.getLoads()]).then(([r, l]) => {
      setRoutes(r);
      setLoads(l);
    }).finally(() => setLoading(false));
  }, []);

  const advanceAllEligible = async (routeId: string, loadIds: string[]) => {
    setAdvancingRouteId(routeId);
    setRouteAdvanceSummary(null);
    try {
      const { results } = await api.bulkAdvance(loadIds);
      const succeeded = results.filter((r) => r.success).length;
      setRouteAdvanceSummary(`Route: advanced ${succeeded} of ${results.length} eligible load(s).`);
      refresh();
    } finally {
      setAdvancingRouteId(null);
    }
  };

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
      {routeAdvanceSummary && <div className="card" style={{ marginBottom: 16 }}>{routeAdvanceSummary}</div>}

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
              <button
                className="btn btn-secondary"
                style={{ width: "auto", marginTop: 8 }}
                disabled={advancingRouteId === r.id}
                onClick={() => advanceAllEligible(r.id, r.stops.map((s) => s.loadId))}
              >
                {advancingRouteId === r.id ? "Advancing..." : "Advance All Eligible"}
              </button>
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

function UploadsPage({ onSelectUpload }: { onSelectUpload: (id: string) => void }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"standard" | "legacy">("standard");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    api.getUploads().then(setUploads).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSubmit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createUpload(file, mode);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refresh();
      onSelectUpload(result.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Bulk Import</h2>
      </div>

      <div className="card">
        <div className="form-group">
          <label>Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as "standard" | "legacy")}>
            <option value="standard">Standard</option>
            <option value="legacy">Legacy (alias-based matching)</option>
          </select>
        </div>
        <div className="form-group">
          <button type="button" className="btn btn-secondary" onClick={() => api.downloadUploadTemplate()}>
            Download template
          </button>
        </div>
        <div className="form-group">
          <input ref={fileInputRef} type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {error && <div className="error">{error}</div>}
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={!file || busy}>
          {busy ? "Uploading..." : "Upload"}
        </button>
      </div>

      <div className="page-header" style={{ marginTop: 24 }}>
        <h3>History</h3>
      </div>
      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : uploads.length === 0 ? (
        <div className="empty-state">No uploads yet.</div>
      ) : (
        uploads.map((u) => (
          <div className="card" key={u.id} style={{ cursor: "pointer" }} onClick={() => onSelectUpload(u.id)}>
            <div className="audit-row">
              <span style={{ fontWeight: 600 }}>{u.fileName}</span>
              <span className="label">{u.mode}</span>
              <span className="label">{u.status}</span>
              <span className="label">{u.totalRows - u.errorRows}/{u.totalRows} ok</span>
              <span className="time">{new Date(u.createdAt).toLocaleString()}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function UploadDetailPage({ uploadId, onBack }: { uploadId: string; onBack: () => void }) {
  const [upload, setUpload] = useState<Upload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aliasTarget, setAliasTarget] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    api.getUpload(uploadId).then(setUpload).finally(() => setLoading(false));
  }, [uploadId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <div className="empty-state">Loading...</div>;
  if (!upload) return <div className="empty-state">Upload not found.</div>;

  const addAlias = async (row: UploadRow, kind: "carrier" | "vehicle" | "driver") => {
    const targetId = aliasTarget[row.id];
    if (!targetId) return;
    const aliasText = kind === "carrier" ? row.carrierName : kind === "vehicle" ? row.vehicleUnitNo : row.driverName;
    if (!aliasText) return;
    setBusy(true);
    setError(null);
    try {
      await api.addUploadAlias(uploadId, kind, aliasText, targetId);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.confirmUpload(uploadId);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="back-link" onClick={onBack}>&larr; Back to Bulk Import</div>
      <div className="page-header">
        <h2>{upload.fileName}</h2>
      </div>
      <div className="card">
        <div className="detail-field"><span className="label">Mode</span><span className="value">{upload.mode}</span></div>
        <div className="detail-field"><span className="label">Status</span><span className="value">{upload.status}</span></div>
        <div className="detail-field"><span className="label">Rows</span><span className="value">{upload.totalRows - upload.errorRows}/{upload.totalRows} ok</span></div>
      </div>

      {error && <div className="error">{error}</div>}

      {upload.status === "complete" ? (
        <div className="card">
          Created {upload.createdLoadIds.length} load(s):{" "}
          {upload.createdLoadIds.map((id) => (
            <Link key={id} to={`/app/loads/${id}`}>{id}</Link>
          ))}
        </div>
      ) : (
        <>
          {(upload.rows ?? []).map((row) => (
            <div className="card" key={row.id}>
              <div className="audit-row">
                <span>#{row.rowIndex + 1}</span>
                <span>{row.origin} &rarr; {row.destination}</span>
                <span className="label">{row.status === "ok" ? "OK" : "ERROR"}</span>
              </div>
              {row.hosNote && <div className="label">HOS: {row.hosNote}</div>}
              {row.errors.length > 0 && (
                <div className="error">
                  {row.errors.join("; ")}
                  {upload.mode === "legacy" && row.errors.some((e) => e.startsWith("Carrier not found") || e.startsWith("Driver not found")) && (
                    <div className="form-group" style={{ marginTop: 8 }}>
                      <input
                        placeholder="Existing record ID to alias to"
                        value={aliasTarget[row.id] ?? ""}
                        onChange={(e) => setAliasTarget((s) => ({ ...s, [row.id]: e.target.value }))}
                      />
                      {row.errors.some((e) => e.startsWith("Carrier not found")) && (
                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => addAlias(row, "carrier")}>
                          Add carrier alias
                        </button>
                      )}
                      {row.errors.some((e) => e.startsWith("Driver not found")) && (
                        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => addAlias(row, "driver")}>
                          Add driver alias
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-primary" disabled={busy || upload.errorRows > 0} onClick={confirm}>
            {upload.errorRows > 0 ? `Fix ${upload.errorRows} error row(s) to confirm` : `Create ${upload.totalRows} Load(s)`}
          </button>
        </>
      )}
    </div>
  );
}

function UsersPage({ user }: { user: User }) {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [carriers, setCarriers] = useState<CarrierCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "invited" | "active">("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("dispatcher");
  const [carrierCompanyId, setCarrierCompanyId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [unlinkedDrivers, setUnlinkedDrivers] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.getUsers({ q: q || undefined, status: statusFilter || undefined }).then(setUsers).finally(() => setLoading(false));
  }, [q, statusFilter]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { api.getCarrierCompanies().then(setCarriers); }, []);

  useEffect(() => {
    if (role !== "driver" || !carrierCompanyId) {
      setUnlinkedDrivers([]);
      return;
    }
    fetch(`/api/drivers?carrierCompanyId=${carrierCompanyId}&unlinked=true`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.json())
      .then(setUnlinkedDrivers);
  }, [role, carrierCompanyId]);

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.inviteUser({ firstName, lastName, email, role, carrierCompanyId: role === "driver" ? carrierCompanyId : undefined, driverId: role === "driver" ? driverId : undefined });
      setFirstName(""); setLastName(""); setEmail(""); setRole("dispatcher"); setCarrierCompanyId(""); setDriverId("");
      setShowInviteForm(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async (id: string) => {
    setBusy(true);
    try {
      await api.resendInvite(id);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const editRole = async (id: string, newRole: UserRole) => {
    setBusy(true);
    try {
      await api.updateUser(id, { role: newRole });
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const togglePlatformAdmin = async (u: UserAccount) => {
    setBusy(true);
    try {
      await api.updateUser(u.id, { platformAdmin: !u.platformAdmin });
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const impersonate = async (u: UserAccount) => {
    setBusy(true);
    setError(null);
    try {
      const admin = { token: getToken(), user };
      const result = await api.impersonateUser(u.id);
      localStorage.setItem("impersonatorSession", JSON.stringify(admin));
      setToken(result.token);
      localStorage.setItem("user", JSON.stringify(result.user));
      window.location.href = "/app";
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Users</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowInviteForm((v) => !v)}>
          {showInviteForm ? "Cancel" : "+ Invite user"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {showInviteForm && (
        <form className="card" onSubmit={submitInvite}>
          <div className="form-group">
            <label>First name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Last name</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="dispatcher">Dispatcher</option>
              <option value="fleet_admin">Fleet Admin</option>
              <option value="maintenance_tech">Maintenance Technician</option>
              <option value="compliance_officer">Compliance Officer</option>
              <option value="driver">Driver</option>
            </select>
          </div>
          {role === "driver" && (
            <>
              <div className="form-group">
                <label>Carrier company</label>
                <select value={carrierCompanyId} onChange={(e) => setCarrierCompanyId(e.target.value)} required>
                  <option value="">Select a carrier...</option>
                  {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Link to driver</label>
                <select value={driverId} onChange={(e) => setDriverId(e.target.value)} required disabled={!carrierCompanyId}>
                  <option value="">Select a driver...</option>
                  {unlinkedDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </>
          )}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Sending..." : "Send Invite"}
          </button>
        </form>
      )}

      <div className="form-group" style={{ marginTop: 16 }}>
        <input placeholder="Search by name or email..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="form-group">
        {(["", "invited", "active"] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            className={statusFilter === s ? "btn btn-primary" : "btn btn-secondary"}
            onClick={() => setStatusFilter(s)}
            style={{ marginRight: 8 }}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : users.length === 0 ? (
        <div className="empty-state">No users match.</div>
      ) : (
        users.map((u) => (
          <div className="card" key={u.id}>
            <div className="audit-row">
              <span style={{ fontWeight: 600 }}>{u.name}</span>
              <span className="label">{u.email}</span>
              <select value={u.role} onChange={(e) => editRole(u.id, e.target.value as UserRole)} disabled={busy}>
                <option value="dispatcher">Dispatcher</option>
                <option value="fleet_admin">Fleet Admin</option>
                <option value="maintenance_tech">Maintenance Technician</option>
                <option value="compliance_officer">Compliance Officer</option>
                <option value="driver">Driver</option>
              </select>
              <span className="label">{u.status}</span>
              <label style={{ fontSize: 12 }}>
                <input type="checkbox" checked={u.platformAdmin} onChange={() => togglePlatformAdmin(u)} disabled={busy} /> platformAdmin
              </label>
              {u.status === "invited" && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => resend(u.id)}>Resend</button>
              )}
              {user.platformAdmin && !u.platformAdmin && u.id !== user.id && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => impersonate(u)}>Impersonate</button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getSettings().then(setSettings).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startEdit = (setting: Setting) => {
    setEditingKey(setting.key);
    setEditValue(setting.value);
  };

  const saveEdit = async (key: string) => {
    setBusyKey(key);
    setError(null);
    try {
      await api.updateSetting(key, editValue);
      setEditingKey(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyKey(null);
    }
  };

  const addSetting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    setBusyKey(newKey);
    setError(null);
    try {
      await api.updateSetting(newKey.trim(), newValue);
      setNewKey("");
      setNewValue("");
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
      </div>

      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : settings.length === 0 ? (
        <div className="empty-state">No settings configured.</div>
      ) : (
        settings.map((s) => (
          <div className="card" key={s.id} style={{ marginBottom: 8 }}>
            <div className="audit-row">
              <span style={{ fontWeight: 600 }}>{s.key}</span>
              {editingKey === s.key ? (
                <>
                  <input value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                  <button type="button" className="btn btn-primary" disabled={busyKey === s.key} onClick={() => saveEdit(s.key)}>
                    {busyKey === s.key ? "Saving..." : "Save"}
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingKey(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span className="label">{s.value}</span>
                  <button type="button" className="btn btn-secondary" onClick={() => startEdit(s)}>Edit</button>
                </>
              )}
              <span className="time">{new Date(s.updatedAt).toLocaleString()}</span>
            </div>
          </div>
        ))
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Add Setting</h3>
        <form onSubmit={addSetting} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input placeholder="key" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <input placeholder="value" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={!newKey.trim() || busyKey === newKey.trim()}>
            Add
          </button>
        </form>
      </div>
    </div>
  );
}

function CarrierCompaniesPage() {
  const [carriers, setCarriers] = useState<CarrierCompany[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<CarrierCompany>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCarrier, setNewCarrier] = useState<Partial<CarrierCompany>>({ name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api.getCarrierCompanies(), api.getVehicles()])
      .then(([c, v]) => { setCarriers(c); setVehicles(v); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startEdit = (c: CarrierCompany) => {
    setEditingId(c.id);
    setEditDraft({ name: c.name, contactName: c.contactName, contactEmail: c.contactEmail, documentExpiryAlertDays: c.documentExpiryAlertDays, defaultVehicleId: c.defaultVehicleId });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateCarrierCompany(editingId, editDraft);
      setEditingId(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addCarrier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCarrier.name?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createCarrierCompany(newCarrier);
      setNewCarrier({ name: "" });
      setShowAddForm(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Carrier Companies</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Carrier"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {showAddForm && (
        <form className="card" onSubmit={addCarrier}>
          <div className="form-group">
            <label>Name</label>
            <input value={newCarrier.name ?? ""} onChange={(e) => setNewCarrier((c) => ({ ...c, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>Contact Name</label>
            <input value={newCarrier.contactName ?? ""} onChange={(e) => setNewCarrier((c) => ({ ...c, contactName: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Contact Email</label>
            <input value={newCarrier.contactEmail ?? ""} onChange={(e) => setNewCarrier((c) => ({ ...c, contactEmail: e.target.value }))} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
        </form>
      )}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : carriers.length === 0 ? (
        <div className="empty-state">No carrier companies yet.</div>
      ) : (
        carriers.map((c) => (
          <div className="card" key={c.id} style={{ marginBottom: 8 }}>
            {editingId === c.id ? (
              <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={editDraft.name ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" />
                <input value={editDraft.contactName ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, contactName: e.target.value }))} placeholder="Contact Name" />
                <input value={editDraft.contactEmail ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, contactEmail: e.target.value }))} placeholder="Contact Email" />
                <input type="number" value={editDraft.documentExpiryAlertDays ?? 30} onChange={(e) => setEditDraft((d) => ({ ...d, documentExpiryAlertDays: Number(e.target.value) }))} placeholder="Document expiry alert (days)" />
                <select value={editDraft.defaultVehicleId ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, defaultVehicleId: e.target.value || null }))}>
                  <option value="">No default vehicle</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.unitNumber} ({v.make} {v.model})</option>)}
                </select>
                <div>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={saveEdit}>Save</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="audit-row">
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span className="label">{c.contactName || "—"}</span>
                <span className="label">{c.contactEmail || "—"}</span>
                <span className="label">alert: {c.documentExpiryAlertDays ?? 30}d</span>
                <button type="button" className="btn btn-secondary" onClick={() => startEdit(c)}>Edit</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function FleetVehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [carriers, setCarriers] = useState<CarrierCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Vehicle>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newVehicle, setNewVehicle] = useState<Partial<Vehicle>>({ vin: "", unitNumber: "", make: "", model: "", plate: "", type: "other" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api.getVehicles(), api.getCarrierCompanies()])
      .then(([v, c]) => { setVehicles(v); setCarriers(c); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startEdit = (v: Vehicle) => {
    setEditingId(v.id);
    setEditDraft({ make: v.make, model: v.model, plate: v.plate, year: v.year, fuelType: v.fuelType, status: v.status, homeTerminal: v.homeTerminal, carrierCompanyId: v.carrierCompanyId, type: v.type });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateVehicle(editingId, editDraft);
      setEditingId(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVehicle.vin?.trim() || !newVehicle.unitNumber?.trim() || !newVehicle.make?.trim() || !newVehicle.model?.trim() || !newVehicle.plate?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createVehicle(newVehicle);
      setNewVehicle({ vin: "", unitNumber: "", make: "", model: "", plate: "" });
      setShowAddForm(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Vehicles</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Vehicle"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {showAddForm && (
        <form className="card" onSubmit={addVehicle}>
          <div className="form-group"><label>VIN</label><input value={newVehicle.vin ?? ""} onChange={(e) => setNewVehicle((v) => ({ ...v, vin: e.target.value }))} required /></div>
          <div className="form-group"><label>Unit Number</label><input value={newVehicle.unitNumber ?? ""} onChange={(e) => setNewVehicle((v) => ({ ...v, unitNumber: e.target.value }))} required /></div>
          <div className="form-group"><label>Make</label><input value={newVehicle.make ?? ""} onChange={(e) => setNewVehicle((v) => ({ ...v, make: e.target.value }))} required /></div>
          <div className="form-group"><label>Model</label><input value={newVehicle.model ?? ""} onChange={(e) => setNewVehicle((v) => ({ ...v, model: e.target.value }))} required /></div>
          <div className="form-group"><label>Plate</label><input value={newVehicle.plate ?? ""} onChange={(e) => setNewVehicle((v) => ({ ...v, plate: e.target.value }))} required /></div>
          <div className="form-group">
            <label>Type</label>
            <select value={newVehicle.type ?? "other"} onChange={(e) => setNewVehicle((v) => ({ ...v, type: e.target.value as Vehicle["type"] }))}>
              <option value="truck">Truck</option>
              <option value="trailer">Trailer</option>
              <option value="van">Van</option>
              <option value="other">Other</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
        </form>
      )}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : vehicles.length === 0 ? (
        <div className="empty-state">No vehicles yet.</div>
      ) : (
        vehicles.map((v) => (
          <div className="card" key={v.id} style={{ marginBottom: 8 }}>
            {editingId === v.id ? (
              <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={editDraft.make ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, make: e.target.value }))} placeholder="Make" />
                <input value={editDraft.model ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, model: e.target.value }))} placeholder="Model" />
                <input value={editDraft.plate ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, plate: e.target.value }))} placeholder="Plate" />
                <select value={editDraft.status ?? "active"} onChange={(e) => setEditDraft((d) => ({ ...d, status: e.target.value as Vehicle["status"] }))}>
                  <option value="active">Active</option>
                  <option value="in_maintenance">In Maintenance</option>
                  <option value="out_of_service">Out of Service</option>
                  <option value="retired">Retired</option>
                </select>
                <select value={editDraft.carrierCompanyId ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, carrierCompanyId: e.target.value || null }))}>
                  <option value="">Company-owned</option>
                  {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={editDraft.type ?? "other"} onChange={(e) => setEditDraft((d) => ({ ...d, type: e.target.value as Vehicle["type"] }))}>
                  <option value="truck">Truck</option>
                  <option value="trailer">Trailer</option>
                  <option value="van">Van</option>
                  <option value="other">Other</option>
                </select>
                <div>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={saveEdit}>Save</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="audit-row">
                <span style={{ fontWeight: 600 }}>{v.unitNumber}</span>
                <span className="label">{v.make} {v.model}</span>
                <span className="label">{v.plate}</span>
                <span className="label">{v.status ?? "active"}</span>
                <span className="label">{v.type ?? "other"}</span>
                <button type="button" className="btn btn-secondary" onClick={() => startEdit(v)}>Edit</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function FleetDriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [carriers, setCarriers] = useState<CarrierCompany[]>([]);
  const [rulesets, setRulesets] = useState<HosRuleset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Driver>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDriver, setNewDriver] = useState<Partial<Driver>>({ name: "", licenseExpiry: "", medicalCertExpiry: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api.getDrivers(), api.getCarrierCompanies(), api.getHosRulesets()])
      .then(([d, c, r]) => { setDrivers(d); setCarriers(c); setRulesets(r); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startEdit = (d: Driver) => {
    setEditingId(d.id);
    setEditDraft({ name: d.name, licenseClass: d.licenseClass, homeTerminal: d.homeTerminal, hosRulesetId: d.hosRulesetId, adminStatus: d.adminStatus, carrierCompanyId: d.carrierCompanyId });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateDriver(editingId, editDraft);
      setEditingId(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addDriver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriver.name?.trim() || !newDriver.licenseExpiry || !newDriver.medicalCertExpiry) return;
    setBusy(true);
    setError(null);
    try {
      await api.createDriver(newDriver);
      setNewDriver({ name: "", licenseExpiry: "", medicalCertExpiry: "" });
      setShowAddForm(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Drivers</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Driver"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {showAddForm && (
        <form className="card" onSubmit={addDriver}>
          <div className="form-group"><label>Name</label><input value={newDriver.name ?? ""} onChange={(e) => setNewDriver((d) => ({ ...d, name: e.target.value }))} required /></div>
          <div className="form-group"><label>License Expiry</label><input type="date" value={newDriver.licenseExpiry ?? ""} onChange={(e) => setNewDriver((d) => ({ ...d, licenseExpiry: e.target.value }))} required /></div>
          <div className="form-group"><label>Medical Cert Expiry</label><input type="date" value={newDriver.medicalCertExpiry ?? ""} onChange={(e) => setNewDriver((d) => ({ ...d, medicalCertExpiry: e.target.value }))} required /></div>
          <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
        </form>
      )}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : drivers.length === 0 ? (
        <div className="empty-state">No drivers yet.</div>
      ) : (
        drivers.map((d) => (
          <div className="card" key={d.id} style={{ marginBottom: 8 }}>
            {editingId === d.id ? (
              <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={editDraft.name ?? ""} onChange={(e) => setEditDraft((f) => ({ ...f, name: e.target.value }))} placeholder="Name" />
                <input value={editDraft.licenseClass ?? ""} onChange={(e) => setEditDraft((f) => ({ ...f, licenseClass: e.target.value }))} placeholder="License Class" />
                <select value={editDraft.hosRulesetId ?? ""} onChange={(e) => setEditDraft((f) => ({ ...f, hosRulesetId: e.target.value || null }))}>
                  <option value="">No HOS ruleset</option>
                  {rulesets.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <select value={editDraft.adminStatus ?? "active"} onChange={(e) => setEditDraft((f) => ({ ...f, adminStatus: e.target.value as Driver["adminStatus"] }))}>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
                <select value={editDraft.carrierCompanyId ?? ""} onChange={(e) => setEditDraft((f) => ({ ...f, carrierCompanyId: e.target.value || null }))}>
                  <option value="">Company-employed</option>
                  {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={saveEdit}>Save</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="audit-row">
                <span style={{ fontWeight: 600 }}>{d.name}</span>
                <span className="label">{d.licenseClass || "—"}</span>
                <span className="label">{d.adminStatus ?? "active"}</span>
                <button type="button" className="btn btn-secondary" onClick={() => startEdit(d)}>Edit</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function DefectCategoriesPage() {
  const [categories, setCategories] = useState<DefectCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<DefectCategory>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategory, setNewCategory] = useState<Partial<DefectCategory>>({ name: "", outcome: "minor_defect", excludedVehicleTypes: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const VEHICLE_TYPES = ["truck", "trailer", "van", "other"];

  const refresh = useCallback(() => {
    api.getDefectCategories()
      .then(setCategories)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleExclusion = (list: string[] | undefined, type: string): string[] => {
    const current = list ?? [];
    return current.includes(type) ? current.filter((t) => t !== type) : [...current, type];
  };

  const startEdit = (c: DefectCategory) => {
    setEditingId(c.id);
    setEditDraft({ name: c.name, outcome: c.outcome, requiresTechnicianNote: c.requiresTechnicianNote, excludedVehicleTypes: c.excludedVehicleTypes });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateDefectCategory(editingId, editDraft);
      setEditingId(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategory.name?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createDefectCategory(newCategory);
      setNewCategory({ name: "", outcome: "minor_defect", excludedVehicleTypes: [] });
      setShowAddForm(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Defect Categories</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Category"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {showAddForm && (
        <form className="card" onSubmit={addCategory}>
          <div className="form-group">
            <label>Name</label>
            <input value={newCategory.name ?? ""} onChange={(e) => setNewCategory((c) => ({ ...c, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>Outcome</label>
            <select value={newCategory.outcome ?? "minor_defect"} onChange={(e) => setNewCategory((c) => ({ ...c, outcome: e.target.value as DefectCategory["outcome"] }))}>
              <option value="pass">Pass</option>
              <option value="minor_defect">Minor Defect</option>
              <option value="out_of_service">Out of Service</option>
            </select>
          </div>
          <div className="form-group">
            <label>Excluded Vehicle Types</label>
            <div style={{ display: "flex", gap: 12 }}>
              {VEHICLE_TYPES.map((t) => (
                <label key={t} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={(newCategory.excludedVehicleTypes ?? []).includes(t)}
                    onChange={() => setNewCategory((c) => ({ ...c, excludedVehicleTypes: toggleExclusion(c.excludedVehicleTypes, t) }))}
                  />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
        </form>
      )}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : categories.length === 0 ? (
        <div className="empty-state">No defect categories yet.</div>
      ) : (
        categories.map((c) => (
          <div className="card" key={c.id} style={{ marginBottom: 8 }}>
            {editingId === c.id ? (
              <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={editDraft.name ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" />
                <select value={editDraft.outcome ?? "minor_defect"} onChange={(e) => setEditDraft((d) => ({ ...d, outcome: e.target.value as DefectCategory["outcome"] }))}>
                  <option value="pass">Pass</option>
                  <option value="minor_defect">Minor Defect</option>
                  <option value="out_of_service">Out of Service</option>
                </select>
                <div style={{ display: "flex", gap: 12 }}>
                  {VEHICLE_TYPES.map((t) => (
                    <label key={t} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={(editDraft.excludedVehicleTypes ?? []).includes(t)}
                        onChange={() => setEditDraft((d) => ({ ...d, excludedVehicleTypes: toggleExclusion(d.excludedVehicleTypes, t) }))}
                      />
                      {t}
                    </label>
                  ))}
                </div>
                <div>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={saveEdit}>Save</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="audit-row">
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span className="label">{c.outcome}</span>
                <span className="label">excludes: {c.excludedVehicleTypes.length ? c.excludedVehicleTypes.join(", ") : "none"}</span>
                <button type="button" className="btn btn-secondary" onClick={() => startEdit(c)}>Edit</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function VehicleTypeClassesPage() {
  const [classes, setClasses] = useState<VehicleTypeClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<VehicleTypeClass>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newClass, setNewClass] = useState<Partial<VehicleTypeClass>>({ name: "", classKind: "tractor" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.getVehicleTypeClasses().then(setClasses).finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startEdit = (c: VehicleTypeClass) => {
    setEditingId(c.id);
    setEditDraft({ name: c.name, classKind: c.classKind, active: c.active });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateVehicleTypeClass(editingId, editDraft);
      setEditingId(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClass.name?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createVehicleTypeClass(newClass);
      setNewClass({ name: "", classKind: "tractor" });
      setShowAddForm(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Vehicle Type Classes</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "Cancel" : "+ Add Class"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {showAddForm && (
        <form className="card" onSubmit={addClass}>
          <div className="form-group">
            <label>Name</label>
            <input value={newClass.name ?? ""} onChange={(e) => setNewClass((c) => ({ ...c, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>Class</label>
            <select value={newClass.classKind ?? "tractor"} onChange={(e) => setNewClass((c) => ({ ...c, classKind: e.target.value as VehicleTypeClass["classKind"] }))}>
              <option value="tractor">Tractor</option>
              <option value="straight_truck">Straight Truck</option>
              <option value="trailer">Trailer</option>
              <option value="refrigerated_trailer">Refrigerated Trailer</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
        </form>
      )}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : classes.length === 0 ? (
        <div className="empty-state">No vehicle type classes yet.</div>
      ) : (
        classes.map((c) => (
          <div className="card" key={c.id} style={{ marginBottom: 8 }}>
            {editingId === c.id ? (
              <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input value={editDraft.name ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" />
                <select value={editDraft.classKind ?? "tractor"} onChange={(e) => setEditDraft((d) => ({ ...d, classKind: e.target.value as VehicleTypeClass["classKind"] }))}>
                  <option value="tractor">Tractor</option>
                  <option value="straight_truck">Straight Truck</option>
                  <option value="trailer">Trailer</option>
                  <option value="refrigerated_trailer">Refrigerated Trailer</option>
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input type="checkbox" checked={editDraft.active ?? true} onChange={(e) => setEditDraft((d) => ({ ...d, active: e.target.checked }))} />
                  Active
                </label>
                <div>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={saveEdit}>Save</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="audit-row">
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                <span className="label">{c.classKind}</span>
                <span className="label">{c.sourceMarker}</span>
                <span className="label">{c.active ? "active" : "inactive"}</span>
                <button type="button" className="btn btn-secondary" onClick={() => startEdit(c)}>Edit</button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function MaintenanceIntervalTemplatesPage() {
  const [classes, setClasses] = useState<VehicleTypeClass[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [templates, setTemplates] = useState<MaintenanceIntervalTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<MaintenanceIntervalTemplate>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTemplate, setNewTemplate] = useState<Partial<MaintenanceIntervalTemplate>>({ taskName: "", basis: "mileage", intervalValue: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getVehicleTypeClasses().then((c) => {
      setClasses(c);
      if (c.length > 0) setSelectedClassId(c[0].id);
    }).finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(() => {
    if (!selectedClassId) { setTemplates([]); return; }
    api.getMaintenanceIntervalTemplates(selectedClassId).then(setTemplates);
  }, [selectedClassId]);

  useEffect(() => { refresh(); }, [refresh]);

  const startEdit = (t: MaintenanceIntervalTemplate) => {
    setEditingId(t.id);
    setEditDraft({ taskName: t.taskName, basis: t.basis, intervalValue: t.intervalValue, appliesToggle: t.appliesToggle });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateMaintenanceIntervalTemplate(editingId, editDraft);
      setEditingId(null);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const addTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplate.taskName?.trim() || !selectedClassId) return;
    setBusy(true);
    setError(null);
    try {
      await api.createMaintenanceIntervalTemplate({ ...newTemplate, vehicleTypeClassId: selectedClassId });
      setNewTemplate({ taskName: "", basis: "mileage", intervalValue: 0 });
      setShowAddForm(false);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Maintenance Interval Templates</h2>
        <button type="button" className="btn btn-primary" onClick={() => setShowAddForm((v) => !v)} disabled={!selectedClassId}>
          {showAddForm ? "Cancel" : "+ Add Template"}
        </button>
      </div>

      {classes.length === 0 ? (
        <div className="empty-state">No vehicle type classes exist yet — create one first.</div>
      ) : (
        <>
          <div className="form-group">
            <label>Vehicle Type Class</label>
            <select value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)}>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {error && <div className="error">{error}</div>}

          {showAddForm && (
            <form className="card" onSubmit={addTemplate}>
              <div className="form-group">
                <label>Task Name</label>
                <input value={newTemplate.taskName ?? ""} onChange={(e) => setNewTemplate((t) => ({ ...t, taskName: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Basis</label>
                <select value={newTemplate.basis ?? "mileage"} onChange={(e) => setNewTemplate((t) => ({ ...t, basis: e.target.value as MaintenanceIntervalTemplate["basis"] }))}>
                  <option value="mileage">Mileage</option>
                  <option value="time">Time</option>
                  <option value="engine_hour">Engine Hour</option>
                </select>
              </div>
              <div className="form-group">
                <label>Interval Value</label>
                <input type="number" value={newTemplate.intervalValue ?? 0} onChange={(e) => setNewTemplate((t) => ({ ...t, intervalValue: Number(e.target.value) }))} required />
              </div>
              <button type="submit" className="btn btn-primary" disabled={busy}>Add</button>
            </form>
          )}

          {templates.length === 0 ? (
            <div className="empty-state">No templates for this class yet.</div>
          ) : (
            templates.map((t) => (
              <div className="card" key={t.id} style={{ marginBottom: 8 }}>
                {editingId === t.id ? (
                  <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input value={editDraft.taskName ?? ""} onChange={(e) => setEditDraft((d) => ({ ...d, taskName: e.target.value }))} placeholder="Task Name" />
                    <select value={editDraft.basis ?? "mileage"} onChange={(e) => setEditDraft((d) => ({ ...d, basis: e.target.value as MaintenanceIntervalTemplate["basis"] }))}>
                      <option value="mileage">Mileage</option>
                      <option value="time">Time</option>
                      <option value="engine_hour">Engine Hour</option>
                    </select>
                    <input type="number" value={editDraft.intervalValue ?? 0} onChange={(e) => setEditDraft((d) => ({ ...d, intervalValue: Number(e.target.value) }))} />
                    <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <input type="checkbox" checked={editDraft.appliesToggle ?? true} onChange={(e) => setEditDraft((d) => ({ ...d, appliesToggle: e.target.checked }))} />
                      Interval Applies
                    </label>
                    <div>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={saveEdit}>Save</button>
                      <button type="button" className="btn btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="audit-row">
                    <span style={{ fontWeight: 600 }}>{t.taskName}</span>
                    <span className="label">{t.basis}: {t.intervalValue}</span>
                    <span className="label">{t.appliesToggle ? "applies" : "does not apply"}</span>
                    <button type="button" className="btn btn-secondary" onClick={() => startEdit(t)}>Edit</button>
                  </div>
                )}
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}

const NOTIFICATION_TEMPLATE_SETTING_KEY = "driver_assignment_notification_template";
const NOTIFICATION_TEMPLATE_SAMPLE = {
  driverName: "Alice Eligible",
  routeRef: "RTE00042",
  dispatchTime: "2026-09-15 08:00",
  vehicleUnitNumber: "UNIT-101",
  stopCount: "3",
};

interface NotificationTemplateDraft {
  subject: string;
  title: string;
  intro: string;
  closing: string;
  signature: string;
}

function renderTemplateField(text: string): string {
  return text
    .replace(/\{\{driverName\}\}/g, NOTIFICATION_TEMPLATE_SAMPLE.driverName)
    .replace(/\{\{routeRef\}\}/g, NOTIFICATION_TEMPLATE_SAMPLE.routeRef)
    .replace(/\{\{dispatchTime\}\}/g, NOTIFICATION_TEMPLATE_SAMPLE.dispatchTime)
    .replace(/\{\{vehicleUnitNumber\}\}/g, NOTIFICATION_TEMPLATE_SAMPLE.vehicleUnitNumber)
    .replace(/\{\{stopCount\}\}/g, NOTIFICATION_TEMPLATE_SAMPLE.stopCount);
}

function NotificationTemplatePage() {
  const [draft, setDraft] = useState<NotificationTemplateDraft>({ subject: "", title: "", intro: "", closing: "", signature: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then((settings) => {
      const row = settings.find((s) => s.key === NOTIFICATION_TEMPLATE_SETTING_KEY);
      if (row) {
        try {
          setDraft(JSON.parse(row.value));
        } catch {
          // Malformed stored value — fall back to the blank draft rather than crashing the page.
        }
      }
    }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateSetting(NOTIFICATION_TEMPLATE_SETTING_KEY, JSON.stringify(draft));
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Driver Assignment Notification Template</h2>
      </div>

      {error && <div className="error">{error}</div>}
      {saved && <div className="card" style={{ marginBottom: 12 }}>Saved.</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="label">Merge fields: {"{{driverName}}"}, {"{{routeRef}}"}, {"{{dispatchTime}}"}, {"{{vehicleUnitNumber}}"}, {"{{stopCount}}"}</p>
      </div>

      <div className="form-group"><label>Subject</label><input value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} /></div>
      <div className="form-group"><label>Title</label><input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} /></div>
      <div className="form-group"><label>Intro</label><input value={draft.intro} onChange={(e) => setDraft((d) => ({ ...d, intro: e.target.value }))} /></div>
      <div className="form-group"><label>Closing</label><input value={draft.closing} onChange={(e) => setDraft((d) => ({ ...d, closing: e.target.value }))} /></div>
      <div className="form-group"><label>Signature</label><input value={draft.signature} onChange={(e) => setDraft((d) => ({ ...d, signature: e.target.value }))} /></div>

      <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>Save</button>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Preview</h3>
        <p><strong>Subject:</strong> {renderTemplateField(draft.subject)}</p>
        <p><strong>{renderTemplateField(draft.title)}</strong></p>
        <p>{renderTemplateField(draft.intro)}</p>
        <p>{renderTemplateField(draft.closing)}</p>
        <p>{renderTemplateField(draft.signature)}</p>
      </div>
    </div>
  );
}

const COMPLIANCE_SUMMARY_TEMPLATE_SETTING_KEY = "compliance_summary_template";

interface ComplianceSummaryTemplateDraft {
  intro: string;
  closing: string;
}

function ComplianceSummaryTemplatePage() {
  const [draft, setDraft] = useState<ComplianceSummaryTemplateDraft>({ intro: "", closing: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then((settings) => {
      const row = settings.find((s) => s.key === COMPLIANCE_SUMMARY_TEMPLATE_SETTING_KEY);
      if (row) {
        try {
          setDraft(JSON.parse(row.value));
        } catch {
          // Malformed stored value — fall back to the blank draft rather than crashing the page.
        }
      }
    }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateSetting(COMPLIANCE_SUMMARY_TEMPLATE_SETTING_KEY, JSON.stringify(draft));
      setSaved(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="empty-state">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h2>Compliance Summary Template</h2>
      </div>

      {error && <div className="error">{error}</div>}
      {saved && <div className="card" style={{ marginBottom: 12 }}>Saved.</div>}

      <div className="card" style={{ marginBottom: 12 }}>
        <p className="label">Merge fields: {"{{routeReference}}"}, {"{{finalizedAt}}"}, {"{{reviewedByName}}"}. This only affects the internal summary — the external audit export is fixed.</p>
      </div>

      <div className="form-group"><label>Intro</label><textarea value={draft.intro} onChange={(e) => setDraft((d) => ({ ...d, intro: e.target.value }))} rows={3} /></div>
      <div className="form-group"><label>Closing</label><textarea value={draft.closing} onChange={(e) => setDraft((d) => ({ ...d, closing: e.target.value }))} rows={3} /></div>

      <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
    </div>
  );
}

function FuelAnalyticsPage() {
  const [distanceMiles, setDistanceMiles] = useState("");
  const [vehicleType, setVehicleType] = useState("truck");
  const [actualGallonsUsed, setActualGallonsUsed] = useState("");
  const [result, setResult] = useState<FuelEstimate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const estimate = await api.getFuelEstimate(
        Number(distanceMiles),
        vehicleType,
        actualGallonsUsed ? Number(actualGallonsUsed) : undefined
      );
      setResult(estimate);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Fuel Analytics</h2>
      </div>

      {error && <div className="error">{error}</div>}

      <form className="card" onSubmit={calculate}>
        <div className="form-group"><label>Distance (miles)</label><input type="number" value={distanceMiles} onChange={(e) => setDistanceMiles(e.target.value)} required /></div>
        <div className="form-group">
          <label>Vehicle Type</label>
          <select value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
            <option value="truck">Truck</option>
            <option value="trailer">Trailer</option>
            <option value="van">Van</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="form-group"><label>Actual Gallons Used (optional)</label><input type="number" value={actualGallonsUsed} onChange={(e) => setActualGallonsUsed(e.target.value)} /></div>
        <button type="submit" className="btn btn-primary" disabled={busy}>Calculate</button>
      </form>

      {result && (
        <div className="card" style={{ marginTop: 12 }}>
          <p>Expected gallons: {result.expectedGallons.toFixed(2)}</p>
          {result.deviationPercent !== null && <p>Deviation: {result.deviationPercent.toFixed(1)}% {result.deviationFlag ? "(flagged)" : ""}</p>}
        </div>
      )}
    </div>
  );
}

function ReportsPlaceholderPage() {
  return (
    <div>
      <div className="page-header">
        <h2>Reports</h2>
      </div>
      <div className="empty-state">Reporting coming soon.</div>
    </div>
  );
}

function DevToolsPage() {
  const [confirmText, setConfirmText] = useState<Record<string, string>>({ loads: "", routes: "", uploads: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const phrases: Record<"loads" | "routes" | "uploads", string> = {
    loads: "DELETE LOADS",
    routes: "DELETE ROUTES",
    uploads: "DELETE UPLOADS",
  };

  const clear = async (kind: "loads" | "routes" | "uploads") => {
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const res = await api.clearDevData(kind, confirmText[kind]);
      setResult(`Cleared ${kind}: ${JSON.stringify(res)}`);
      setConfirmText((c) => ({ ...c, [kind]: "" }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Dev Tools</h2>
      </div>
      <div className="card" style={{ marginBottom: 12 }}>
        <p className="label">Development/staging only. This screen does not exist in production builds.</p>
      </div>

      {error && <div className="error">{error}</div>}
      {result && <div className="card" style={{ marginBottom: 12 }}>{result}</div>}

      {(["loads", "routes", "uploads"] as const).map((kind) => (
        <div className="card" key={kind} style={{ marginBottom: 8 }}>
          <p>Clear all {kind} for this company. Type <strong>{phrases[kind]}</strong> to confirm.</p>
          <input
            value={confirmText[kind]}
            onChange={(e) => setConfirmText((c) => ({ ...c, [kind]: e.target.value }))}
            placeholder={phrases[kind]}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy === kind || confirmText[kind] !== phrases[kind]}
            onClick={() => clear(kind)}
          >
            {busy === kind ? "Clearing..." : `Clear ${kind}`}
          </button>
        </div>
      ))}
    </div>
  );
}

function ComplianceSummaryModal({ routeId, type, onClose }: { routeId: string; type: "internal" | "external"; onClose: () => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getComplianceSummary(routeId, type).then((r) => setText(r.text)).finally(() => setLoading(false));
  }, [routeId, type]);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ width: "90vw", maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
        <h3>{type === "internal" ? "Internal Compliance Summary" : "External Audit Summary"}</h3>
        {loading ? (
          <div className="empty-state">Loading...</div>
        ) : (
          <textarea readOnly value={text} rows={16} style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} />
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-primary" style={{ width: "auto" }} onClick={copy}>{copied ? "Copied!" : "Copy to Clipboard"}</button>
          <a className="btn btn-secondary" href={api.getComplianceSummaryExportUrl(routeId, type)} download>Download</a>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ComplianceWorkbenchPage() {
  const [queue, setQueue] = useState<ComplianceQueueRoute[]>([]);
  const [finalizedRoutes, setFinalizedRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [summaryModal, setSummaryModal] = useState<{ routeId: string; type: "internal" | "external" } | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api.getComplianceQueue(), api.getFinalizedRoutes()])
      .then(([q, f]) => {
        setQueue(q);
        setFinalizedRoutes(f);
      })
      .finally(() => setLoading(false));
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

      <div className="page-header" style={{ marginTop: 24 }}>
        <h2>Finalized Routes</h2>
      </div>
      {finalizedRoutes.length === 0 ? (
        <div className="empty-state">No finalized routes yet</div>
      ) : (
        finalizedRoutes.map((route) => (
          <div key={route.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: 16 }}>{route.reference}</span>
              <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
                Finalized {new Date(route.complianceRecord.finalizedAt).toLocaleString()}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: 10 }}>
              Pass: {route.complianceRecord.passCount} · Minor Defect: {route.complianceRecord.minorDefectCount} ·
              {" "}Out of Service: {route.complianceRecord.outOfServiceCount} · Total HOS: {route.complianceRecord.totalHosHours.toFixed(1)}h
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSummaryModal({ routeId: route.id, type: "internal" })}>Internal Summary</button>
              <button type="button" className="btn btn-secondary" onClick={() => setSummaryModal({ routeId: route.id, type: "external" })}>External Audit Summary</button>
            </div>
          </div>
        ))
      )}

      {summaryModal && (
        <ComplianceSummaryModal routeId={summaryModal.routeId} type={summaryModal.type} onClose={() => setSummaryModal(null)} />
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

// ─── Load Documents ───────────────────────────────────────

function LoadDocumentsSection({ loadId, canManage }: { loadId: string; canManage: boolean }) {
  const [documents, setDocuments] = useState<LoadDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<LoadDocumentType>("other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    api.getLoadDocuments(loadId).then(setDocuments).finally(() => setLoading(false));
  }, [loadId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleUpload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.uploadLoadDocument(loadId, file, docType);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteLoadDocument(loadId, documentId);
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openDocument = (doc: LoadDocument) => {
    if (doc.mimeType === "application/pdf") {
      window.open(doc.url, "_blank");
    } else {
      setLightboxUrl(doc.url);
    }
  };

  const typeLabel = (t: LoadDocumentType) => (t === "bill_of_lading" ? "Bill of Lading" : t === "pod" ? "POD" : "Other");

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginBottom: 12, fontSize: 16 }}>Documents</h3>

      {canManage && (
        <div className="form-group" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={docType} onChange={(e) => setDocType(e.target.value as LoadDocumentType)}>
            <option value="bill_of_lading">Bill of Lading</option>
            <option value="pod">POD</option>
            <option value="other">Other</option>
          </select>
          <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={handleUpload}>
            {busy ? "Uploading..." : "Upload"}
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : documents.length === 0 ? (
        <div className="empty-state">No documents attached.</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {documents.map((doc) => (
            <div key={doc.id} className="card" style={{ width: 200, cursor: "pointer" }} onClick={() => openDocument(doc)}>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.fileName}</div>
              <div className="label" style={{ marginTop: 4 }}>{typeLabel(doc.type)}</div>
              <div className="label" style={{ fontSize: 12 }}>{doc.uploadedBy.name} &middot; {new Date(doc.createdAt).toLocaleDateString()}</div>
              {canManage && (
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ marginTop: 8, width: "auto" }}
                  disabled={busy}
                  onClick={(e) => { e.stopPropagation(); handleDelete(doc.id); }}
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {lightboxUrl && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setLightboxUrl(null)}
        >
          <img src={lightboxUrl} alt="" style={{ maxWidth: "90vw", maxHeight: "90vh" }} />
        </div>
      )}
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
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);

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

  const previousTargets = load ? statuses.filter((s) => s.position < load.currentStatus.position) : [];

  if (loading || !load) {
    return <div className="empty-state">Loading...</div>;
  }

  return (
    <div>
      <div className="back-link" onClick={onBack}>&larr; Back to Loads</div>

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
        {allowedTransitions.length === 0 && previousTargets.length === 0 ? (
          <p style={{ color: "var(--color-text-secondary)", fontSize: 14 }}>
            No transitions available from current status.
          </p>
        ) : (
          <div className="workflow-controls">
            {allowedTransitions.length > 0 && (
              <button className="btn btn-success" onClick={() => setShowAdvanceModal(true)}>
                Advance
              </button>
            )}
            {previousTargets.length > 0 && (
              <button className="btn btn-danger" onClick={() => setShowRevertModal(true)}>
                Move to Previous
              </button>
            )}
          </div>
        )}
      </div>

      <LoadDocumentsSection loadId={loadId} canManage={canDispatchWrite(user)} />

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

      {showAdvanceModal && (
        <RecordAdvanceModal
          load={load}
          allowedTransitions={allowedTransitions}
          onDone={() => { setShowAdvanceModal(false); refresh(); }}
          onClose={() => setShowAdvanceModal(false)}
        />
      )}
      {showRevertModal && (
        <RecordRevertModal
          load={load}
          allowedTargets={previousTargets}
          onDone={() => { setShowRevertModal(false); refresh(); }}
          onClose={() => setShowRevertModal(false)}
        />
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
    Promise.all([api.getLoad(loadId), api.getStatuses()])
      .then(async ([l, s]) => {
        setLoad(l);
        setStatuses(s);
        const c = await api.getDefectCategories(l.vehicle?.id);
        setCategories(c);
      })
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

const NAV_BUILDER_ROLES = ["driver", "dispatcher", "maintenance_tech", "compliance_officer", "fleet_admin"] as const;

function NavBuilderPage() {
  const [registry, setRegistry] = useState<{ key: string; label: string; eligibleRoles: string[] }[]>([]);
  const [role, setRole] = useState<string>("dispatcher");
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadRole = useCallback((r: string) => {
    api.getNavConfig().then((config) => {
      setRegistry(config.registry);
      const eligible = config.registry.filter((item) => item.eligibleRoles.includes(r));
      const rawOrder = (config.roles[r]?.layout.order ?? []).filter((key) => eligible.some((i) => i.key === key));
      const fullOrder = [...rawOrder, ...eligible.filter((i) => !rawOrder.includes(i.key)).map((i) => i.key)];
      setOrder(fullOrder);
      setHidden(config.roles[r]?.layout.hidden ?? []);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadRole(role); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [role]);

  const eligibleItems = registry.filter((item) => item.eligibleRoles.includes(role));
  const itemsInOrder = order.filter((key) => eligibleItems.some((i) => i.key === key));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= itemsInOrder.length) return;
    const next = [...itemsInOrder];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };

  const toggleHidden = (key: string) => {
    setHidden((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const save = async () => {
    setBusy(true);
    setSaved(false);
    try {
      await api.updateNavLayout(role, { order: itemsInOrder, hidden });
      loadRole(role);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setSaved(false);
    try {
      await api.resetNavLayout(role);
      loadRole(role);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Navigation Builder</h2>
      </div>
      <p style={{ marginBottom: 16, fontSize: 13, color: "var(--color-text-secondary)" }}>
        Reorder or hide sidebar items per role. This only affects roles other than Platform Admin, who always sees
        everything. Items not eligible for a role can never be shown here — this screen only controls order and
        visibility among what a role already has access to.
      </p>

      <div className="form-group" style={{ maxWidth: 260 }}>
        <label>Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {NAV_BUILDER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {saved && <div className="card" style={{ marginBottom: 12 }}>Saved.</div>}

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Visible</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {itemsInOrder.map((key, i) => {
                const item = eligibleItems.find((it) => it.key === key)!;
                return (
                  <tr key={key}>
                    <td>{item.label}</td>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked={!hidden.includes(key)} onChange={() => toggleHidden(key)} />
                    </td>
                    <td style={{ display: "flex", gap: 4 }}>
                      <button type="button" className="btn btn-secondary" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button type="button" className="btn btn-secondary" disabled={i === itemsInOrder.length - 1} onClick={() => move(i, 1)}>↓</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" style={{ width: "auto" }} disabled={busy} onClick={save}>Save</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={reset}>Reset to Defaults</button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowDiagramModal({ statuses, transitions, onClose }: { statuses: DispatchStatus[]; transitions: DispatchTransition[]; onClose: () => void }) {
  const boxWidth = 160;
  const boxHeight = 50;
  const colGap = 220;
  const rowHeight = 90;
  const sorted = [...statuses].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const positions = new Map(sorted.map((s, i) => [s.id, { x: 20 + i * colGap, y: 20 }]));
  const svgWidth = Math.max(400, 20 + sorted.length * colGap);
  const svgHeight = 20 + boxHeight + rowHeight;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ width: "90vw", maxWidth: 1000 }} onClick={(e) => e.stopPropagation()}>
        <h3>Workflow Diagram</h3>
        <div style={{ overflowX: "auto" }}>
          <svg width={svgWidth} height={svgHeight}>
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="var(--color-text-secondary)" />
              </marker>
            </defs>
            {transitions.map((t) => {
              const from = positions.get(t.fromStatus.id);
              const to = positions.get(t.toStatus.id);
              if (!from || !to) return null;
              const x1 = from.x + boxWidth / 2;
              const y1 = from.y + boxHeight;
              const x2 = to.x + boxWidth / 2;
              const y2 = to.y + boxHeight + rowHeight - 10;
              return (
                <g key={t.id}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-text-secondary)" strokeDasharray={t.outcomeTrigger ? "5,3" : undefined} markerEnd="url(#arrowhead)" />
                  {t.outcomeTrigger && (
                    <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} fontSize={10} textAnchor="middle" fill="var(--color-text-secondary)">{t.outcomeTrigger}</text>
                  )}
                </g>
              );
            })}
            {sorted.map((s) => {
              const p = positions.get(s.id)!;
              return (
                <g key={s.id}>
                  <rect x={p.x} y={p.y} width={boxWidth} height={boxHeight} rx={6} fill={s.color || "#5b6270"} stroke={s.isDefault ? "#000" : "none"} strokeWidth={s.isDefault ? 2 : 0} />
                  <text x={p.x + boxWidth / 2} y={p.y + boxHeight / 2 + 4} fontSize={12} textAnchor="middle" fill="#fff">{s.name}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 8 }}>
          Solid arrow = manual transition. Dashed arrow = outcome-triggered. Bold border = default status.
        </p>
        <button type="button" className="btn btn-secondary" onClick={onClose} style={{ marginTop: 8 }}>Close</button>
      </div>
    </div>
  );
}

const ASSIGNABLE_ROLES_FOR_MATRIX = ["driver", "dispatcher", "maintenance_tech", "compliance_officer", "fleet_admin"] as const;

function RoleVisibilityMatrixModal({ statuses, onClose, onChanged }: { statuses: DispatchStatus[]; onClose: () => void; onChanged: () => void }) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const toggle = async (status: DispatchStatus, role: string) => {
    const key = `${status.id}:${role}`;
    setBusyKey(key);
    try {
      const next = status.roleVisibility.includes(role)
        ? status.roleVisibility.filter((r) => r !== role)
        : [...status.roleVisibility, role];
      await api.updateStatus(status.id, { roleVisibility: next });
      onChanged();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ width: "90vw", maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
        <h3>Role Visibility Matrix</h3>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                {ASSIGNABLE_ROLES_FOR_MATRIX.map((r) => <th key={r}>{r}</th>)}
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  {ASSIGNABLE_ROLES_FOR_MATRIX.map((r) => (
                    <td key={r} style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={s.roleVisibility.includes(r)}
                        disabled={busyKey === `${s.id}:${r}`}
                        onChange={() => toggle(s, r)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onClose} style={{ marginTop: 8 }}>Close</button>
      </div>
    </div>
  );
}

// FR-18: per-status columns for the Loads list — same
// matrix-of-checkboxes pattern as RoleVisibilityMatrixModal above.
// Empty loadListColumns means "use the default column set" (client-side).
const LOAD_LIST_COLUMN_KEYS_FOR_MATRIX = ["reference", "origin", "destination", "status", "driver", "vehicle", "docs", "route", "createdAt"] as const;

function LoadListColumnsModal({ statuses, onClose, onChanged }: { statuses: DispatchStatus[]; onClose: () => void; onChanged: () => void }) {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const toggle = async (status: DispatchStatus, columnKey: string) => {
    const key = `${status.id}:${columnKey}`;
    setBusyKey(key);
    try {
      const next = status.loadListColumns.includes(columnKey)
        ? status.loadListColumns.filter((c) => c !== columnKey)
        : [...status.loadListColumns, columnKey];
      await api.updateStatus(status.id, { loadListColumns: next });
      onChanged();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ width: "90vw", maxWidth: 800 }} onClick={(e) => e.stopPropagation()}>
        <h3>Load List Columns</h3>
        <p style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>
          Only applies to the Loads list when it's filtered down to a single status. No columns checked means the default set.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                {LOAD_LIST_COLUMN_KEYS_FOR_MATRIX.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  {LOAD_LIST_COLUMN_KEYS_FOR_MATRIX.map((c) => (
                    <td key={c} style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={s.loadListColumns.includes(c)}
                        disabled={busyKey === `${s.id}:${c}`}
                        onChange={() => toggle(s, c)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onClose} style={{ marginTop: 8 }}>Close</button>
      </div>
    </div>
  );
}

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
  const [showArchived, setShowArchived] = useState(false);
  const [busyStatusId, setBusyStatusId] = useState<string | null>(null);
  const [showDiagram, setShowDiagram] = useState(false);
  const [showRoleMatrix, setShowRoleMatrix] = useState(false);
  const [showLoadListColumns, setShowLoadListColumns] = useState(false);

  const refresh = useCallback(() => {
    Promise.all([api.getStatuses(showArchived), api.getTransitions()]).then(([s, t]) => {
      setStatuses(s);
      setTransitions(t);
    });
  }, [showArchived]);

  useEffect(() => { refresh(); }, [refresh]);

  const moveStatus = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= statuses.length) return;
    const reordered = [...statuses];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setStatuses(reordered);
    await api.reorderStatuses(reordered.map((s) => s.id));
    refresh();
  };

  const archiveOrUnarchive = async (status: DispatchStatus) => {
    setBusyStatusId(status.id);
    setError("");
    try {
      if (status.archived) {
        await api.unarchiveStatus(status.id);
      } else {
        await api.archiveStatus(status.id);
      }
      refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyStatusId(null);
    }
  };

  const deleteStatusRow = async (status: DispatchStatus) => {
    setBusyStatusId(status.id);
    setError("");
    try {
      await api.deleteStatus(status.id);
      refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyStatusId(null);
    }
  };

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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={() => setShowDiagram(true)}>Show Workflow</button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowRoleMatrix(true)}>Role Visibility Matrix</button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowLoadListColumns(true)}>Load List Columns</button>
        </div>
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
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 13 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
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
                <th>Actions</th>
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
                  <td style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {!s.archived && (
                      <>
                        <button type="button" className="btn btn-secondary" disabled={statuses.indexOf(s) === 0} onClick={() => moveStatus(statuses.indexOf(s), -1)}>↑</button>
                        <button type="button" className="btn btn-secondary" disabled={statuses.indexOf(s) === statuses.length - 1} onClick={() => moveStatus(statuses.indexOf(s), 1)}>↓</button>
                      </>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busyStatusId === s.id || (!s.archived && (s.isDefault || s.isDispatchStatus))}
                      onClick={() => archiveOrUnarchive(s)}
                    >
                      {s.archived ? "Unarchive" : "Archive"}
                    </button>
                    <button type="button" className="btn btn-secondary" disabled={busyStatusId === s.id} onClick={() => deleteStatusRow(s)}>Delete</button>
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

      {showDiagram && <WorkflowDiagramModal statuses={statuses} transitions={transitions} onClose={() => setShowDiagram(false)} />}
      {showRoleMatrix && <RoleVisibilityMatrixModal statuses={statuses} onClose={() => setShowRoleMatrix(false)} onChanged={refresh} />}
      {showLoadListColumns && <LoadListColumnsModal statuses={statuses} onClose={() => setShowLoadListColumns(false)} onChanged={refresh} />}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPageRouter />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/app/*" element={<AppLayout />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
