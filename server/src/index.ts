import "dotenv/config";
import express from "express";
import cors from "cors";
import { authenticate, requireRole } from "./middleware/auth";
import authRoutes from "./routes/auth";
import loadRoutes from "./routes/loads";
import statusRoutes from "./routes/statuses";
import driverRoutes from "./routes/drivers";
import vehicleRoutes from "./routes/vehicles";
import { UserRole } from "@prisma/client";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);

// ─── Global middleware ──────────────────────────────────
app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());

// ─── Public routes ──────────────────────────────────────
app.use("/auth", authRoutes);

// ─── Protected routes ───────────────────────────────────
// All routes below require a valid JWT
app.use("/api", authenticate);

// Loads: both dispatcher and fleet_admin can manage loads
app.use("/api/loads", requireRole(UserRole.dispatcher, UserRole.fleet_admin), loadRoutes);

// Statuses & transitions: read-only for both roles
app.use("/api/statuses", requireRole(UserRole.dispatcher, UserRole.fleet_admin), statusRoutes);

// Drivers & vehicles: read-only for both roles
app.use("/api/drivers", requireRole(UserRole.dispatcher, UserRole.fleet_admin), driverRoutes);
app.use("/api/vehicles", requireRole(UserRole.dispatcher, UserRole.fleet_admin), vehicleRoutes);

// ─── Health check ───────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Start ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Vantage Fleet API running on http://localhost:${PORT}`);
});

export default app;
