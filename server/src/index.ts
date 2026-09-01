import "dotenv/config";
import express from "express";
import cors from "cors";
import { authenticate } from "./middleware/auth";
import authRoutes from "./routes/auth";
import loadRoutes from "./routes/loads";
import statusRoutes from "./routes/statuses";
import driverRoutes from "./routes/drivers";
import vehicleRoutes from "./routes/vehicles";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// ─── Global middleware ──────────────────────────────────
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());

// ─── Public routes ──────────────────────────────────────
app.use("/auth", authRoutes);

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

// ─── Health check ───────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Start ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Vantage Fleet API running on http://localhost:${PORT}`);
});

export default app;
