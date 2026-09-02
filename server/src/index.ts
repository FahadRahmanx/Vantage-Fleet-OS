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

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// ─── Global middleware ──────────────────────────────────
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
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

// ─── Health check ───────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Start ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Vantage Fleet API running on http://localhost:${PORT}`);
});

export default app;
