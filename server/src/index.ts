import "dotenv/config";
import express from "express";
import cors from "cors";
import { authenticate } from "./middleware/auth";
import authRoutes from "./routes/auth";
import loadRoutes from "./routes/loads";
import statusRoutes from "./routes/statuses";
import driverRoutes from "./routes/drivers";
import vehicleRoutes from "./routes/vehicles";
import telematicsRoutes from "./routes/telematics";
import hosRoutes from "./routes/hos";
import inspectionRoutes from "./routes/inspections";
import defectCategoryRoutes from "./routes/defect-categories";
import routeRoutes from "./routes/routes";
import complianceRoutes from "./routes/compliance";
import auditRoutes from "./routes/audit";
import uploadRoutes from "./routes/uploads";
import userRoutes from "./routes/users";
import carrierCompanyRoutes from "./routes/carrier-companies";
import dashboardRoutes from "./routes/dashboards";
import settingsRoutes from "./routes/settings";
import hosRulesetRoutes from "./routes/hos-rulesets";
import vehicleTypeClassRoutes from "./routes/vehicle-type-classes";
import maintenanceIntervalTemplateRoutes from "./routes/maintenance-interval-templates";
import fuelAnalyticsRoutes from "./routes/fuel-analytics";
import devToolsRoutes from "./routes/dev-tools";
import triageRoutes from "./routes/triage";
import helpArticleRoutes from "./routes/help-articles";
import navConfigRoutes from "./routes/nav-config";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// Allowed browser origins, comma-separated in CORS_ORIGIN so a deployment
// can add its domain without a code change. The local dev server is always
// permitted so a misconfigured deployment env never breaks development.
const DEV_ORIGIN = "http://localhost:5173";
const allowedOrigins = Array.from(
  new Set(
    (process.env.CORS_ORIGIN || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .concat(DEV_ORIGIN)
  )
);

// ─── Global middleware ──────────────────────────────────
app.use(
  cors({
    // Requests with no Origin header (curl, server-to-server, the telematics
    // partner API) are not browser cross-origin requests, so they pass.
    // A disallowed origin simply gets no allow-origin header, which the
    // browser enforces. Throwing here would turn it into a 500 and also
    // break non-browser callers.
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
    credentials: true,
  })
);
app.use(express.json());

// ─── Public routes ──────────────────────────────────────
app.use("/auth", authRoutes);
// Own auth (per-company bearer token, not the user JWT) — not a logged-in
// user, so this is mounted outside the /api + authenticate block below.
app.use("/api/telematics", telematicsRoutes);

// ─── Protected routes ───────────────────────────────────
// All routes below require a valid JWT. Write actions are gated inside
// each route file via requireCapability (server/src/middleware/permissions.ts),
// not a blanket per-mount role list — the same status will legitimately be
// advanceable by different roles depending on DispatchStatus.roleVisibility
// (Phase 1), which a static mount-level gate can't express.
app.use("/api", authenticate);
app.use("/api/loads", loadRoutes);
app.use("/api/statuses", statusRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/duty-status", hosRoutes);
app.use("/api/inspections", inspectionRoutes);
app.use("/api/defect-categories", defectCategoryRoutes);
app.use("/api/routes", routeRoutes);
app.use("/api/compliance", complianceRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/users", userRoutes);
app.use("/api/carrier-companies", carrierCompanyRoutes);
app.use("/api/dashboards", dashboardRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/hos-rulesets", hosRulesetRoutes);
app.use("/api/vehicle-type-classes", vehicleTypeClassRoutes);
app.use("/api/maintenance-interval-templates", maintenanceIntervalTemplateRoutes);
app.use("/api/fuel-analytics", fuelAnalyticsRoutes);
app.use("/api/triage", triageRoutes);
app.use("/api/help-articles", helpArticleRoutes);
app.use("/api/nav-config", navConfigRoutes);

// FR-57: dev/staging-only maintenance tooling. Gated at mount time (not
// just inside the handlers) so the route path does not exist at all in a
// production process — no request can ever reach it there.
if (process.env.NODE_ENV !== "production") {
  app.use("/api/dev-tools", devToolsRoutes);
}

// ─── Health check ───────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Start ──────────────────────────────────────────────
// Bind all interfaces so the process is reachable behind a reverse proxy
// or from outside the host when deployed, not just on loopback.
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Vantage Fleet API listening on port ${PORT}`);
  console.log(`  allowed browser origins: ${allowedOrigins.join(", ")}`);
});

export default app;
