/**
 * HTTP-level smoke test — exercises auth, role, and company-scope middleware
 * plus the full request/response cycle. Complements test:engine, which only
 * calls the service functions directly.
 *
 * Prereq: dev server running on :3001 and database seeded (see Task 2).
 * Run: npx tsx scripts/smoke-test-http.ts
 */

import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3001";
const prisma = new PrismaClient();
let failures = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  OK   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`);
    failures++;
  }
}

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function authed(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  console.log("=== HTTP Smoke Test ===\n");

  // ── No token → 401 ──
  console.log("--- Unauthenticated access ---");
  const noAuth = await fetch(`${BASE}/api/loads`);
  check("GET /api/loads with no token returns 401", noAuth.status === 401);

  // ── Bad credentials → 401 ──
  console.log("\n--- Login ---");
  const badLogin = await login("dispatcher@test.com", "wrong-password");
  check("Wrong password returns 401", badLogin.status === 401);

  const goodLogin = await login("dispatcher@test.com", "password123");
  check("Correct login returns 200 with a token", goodLogin.status === 200 && !!goodLogin.body.token);
  const token: string = goodLogin.body.token;
  const dispatcherId: string = goodLogin.body.user.id;

  check("Login response includes platformAdmin", goodLogin.body.user.platformAdmin === false);

  const platformAdminLogin = await login("admin@test.com", "password123");
  check("Platform-admin login response has platformAdmin: true", platformAdminLogin.body.user.platformAdmin === true);

  // ── Reference data ──
  console.log("\n--- Reference data ---");
  const drivers = await authed(token, "/api/drivers");
  check("GET /api/drivers returns 200 with entries", drivers.status === 200 && Array.isArray(drivers.body) && drivers.body.length >= 2);
  const eligibleDriver = drivers.body.find((d: any) => d.name === "Alice Eligible");
  const expiredDriver = drivers.body.find((d: any) => d.name === "Charlie Expired");
  check("Seeded eligible + expired drivers both present", !!eligibleDriver && !!expiredDriver);

  const vehicles = await authed(token, "/api/vehicles");
  const vehicle = vehicles.body[0];
  check("GET /api/vehicles returns at least one vehicle", vehicles.status === 200 && !!vehicle);

  const statuses = await authed(token, "/api/statuses");
  const statusMap = Object.fromEntries(statuses.body.map((s: any) => [s.code, s]));
  check("GET /api/statuses returns the 5 seeded statuses", statuses.status === 200 && Object.keys(statusMap).length === 5);

  // ── Golden path: create → assign → advance → revert → advance to delivered ──
  console.log("\n--- Golden path ---");
  const created = await authed(token, "/api/loads", {
    method: "POST",
    body: JSON.stringify({ origin: "Melbourne DC", destination: "Sydney Store #42" }),
  });
  check("POST /api/loads returns 201 in 'created' status", created.status === 201 && created.body.currentStatus.code === "created");
  check("Created load has a VFOxxxxxxx reference (FR-17)", /^VFO\d{7}$/.test(created.body.reference));
  const loadId = created.body.id;

  const blockedAssign = await authed(token, `/api/loads/${loadId}/assign`, {
    method: "POST",
    body: JSON.stringify({ driverId: expiredDriver.id, vehicleId: vehicle.id }),
  });
  check("Assigning expired-cert driver returns 422", blockedAssign.status === 422);

  const okAssign = await authed(token, `/api/loads/${loadId}/assign`, {
    method: "POST",
    body: JSON.stringify({ driverId: eligibleDriver.id, vehicleId: vehicle.id }),
  });
  check("Assigning eligible driver returns 200", okAssign.status === 200);

  const advance1 = await authed(token, `/api/loads/${loadId}/advance`, {
    method: "POST",
    body: JSON.stringify({ targetStatusId: statusMap.assigned.id }),
  });
  check("Advance created → assigned returns 200", advance1.status === 200);

  const badTransition = await authed(token, `/api/loads/${loadId}/advance`, {
    method: "POST",
    body: JSON.stringify({ targetStatusId: statusMap.delivered.id }),
  });
  check("Advance assigned → delivered (not a valid edge) returns 400", badTransition.status === 400);

  const advance2 = await authed(token, `/api/loads/${loadId}/advance`, {
    method: "POST",
    body: JSON.stringify({ targetStatusId: statusMap.in_transit.id }),
  });
  check("Advance assigned → in_transit returns 200", advance2.status === 200);

  const reverted = await authed(token, `/api/loads/${loadId}/revert`, {
    method: "POST",
    body: JSON.stringify({ targetStatusId: statusMap.assigned.id }),
  });
  check("Revert in_transit → assigned returns 200", reverted.status === 200);

  const detail = await authed(token, `/api/loads/${loadId}`);
  check("Load detail includes an audit trail", detail.status === 200 && Array.isArray(detail.body.statusLogs) && detail.body.statusLogs.length === 3);
  check("Advance rows are not marked reverted (FR-35)", detail.body.statusLogs[0]?.reverted === false && detail.body.statusLogs[1]?.reverted === false);
  check("Revert row is marked reverted (FR-35)", detail.body.statusLogs[2]?.reverted === true);

  // ── Edit lock (FR-20): editable only while in Created status ──
  console.log("\n--- Edit lock ---");
  const editTestLoad = await authed(token, "/api/loads", {
    method: "POST",
    body: JSON.stringify({ origin: "Edit Test Origin", destination: "Edit Test Destination" }),
  });
  const editLoadId = editTestLoad.body.id;

  const patchOk = await authed(token, `/api/loads/${editLoadId}`, {
    method: "PATCH",
    body: JSON.stringify({ origin: "Edited Origin" }),
  });
  check("PATCH while Created returns 200", patchOk.status === 200 && patchOk.body.origin === "Edited Origin");

  await authed(token, `/api/loads/${editLoadId}/assign`, {
    method: "POST",
    body: JSON.stringify({ driverId: eligibleDriver.id, vehicleId: vehicle.id }),
  });
  await authed(token, `/api/loads/${editLoadId}/advance`, {
    method: "POST",
    body: JSON.stringify({ targetStatusId: statusMap.assigned.id }),
  });
  const patchBlocked = await authed(token, `/api/loads/${editLoadId}`, {
    method: "PATCH",
    body: JSON.stringify({ origin: "Should Fail" }),
  });
  check("PATCH after advancing past Created returns 400", patchBlocked.status === 400);

  // ── Cross-company isolation via the second role ──
  console.log("\n--- Company scoping ---");
  const adminLogin = await login("admin@test.com", "password123");
  check("fleet_admin login also succeeds", adminLogin.status === 200);

  // ── Driver row-scoping (Phase 0, FR-1/FR-3 extended to the driver role) ──
  console.log("\n--- Driver row-scoping ---");
  const driver1Login = await login("driver@test.com", "password123");
  check("driver login succeeds", driver1Login.status === 200);
  const driver1Token = driver1Login.body.token;

  const driver2Login = await login("driver2@test.com", "password123");
  const driver2Token = driver2Login.body.token;

  // `loadId` was assigned to Alice Eligible earlier in the golden path
  // (driver@test.com's linked driver) — reuse it rather than creating a
  // third load.
  const driver1Loads = await authed(driver1Token, "/api/loads");
  check("driver sees their own assigned load", driver1Loads.status === 200 && driver1Loads.body.some((l: any) => l.id === loadId));

  const driver2Loads = await authed(driver2Token, "/api/loads");
  check("driver cannot see another driver's load in the list", driver2Loads.status === 200 && !driver2Loads.body.some((l: any) => l.id === loadId));

  const driver2Detail = await authed(driver2Token, `/api/loads/${loadId}`);
  check("driver cannot fetch another driver's load by id", driver2Detail.status === 404);

  const driverRosterAttempt = await authed(driver1Token, "/api/drivers");
  check("driver cannot read the fleet roster (drivers)", driverRosterAttempt.status === 403);

  const driverVehiclesAttempt = await authed(driver1Token, "/api/vehicles");
  check("driver cannot read the fleet roster (vehicles)", driverVehiclesAttempt.status === 403);

  const driver1WriteAttempt = await authed(driver1Token, "/api/loads", {
    method: "POST",
    body: JSON.stringify({ origin: "Should Be Blocked", destination: "Should Be Blocked" }),
  });
  check("driver cannot create a load (write capability gate)", driver1WriteAttempt.status === 403);

  const maintenanceLogin = await login("maintenance@test.com", "password123");
  const maintenanceToken = maintenanceLogin.body.token;
  const maintenanceLoadsRead = await authed(maintenanceToken, "/api/loads");
  check("maintenance_tech can read loads", maintenanceLoadsRead.status === 200);
  const maintenanceWriteAttempt = await authed(maintenanceToken, "/api/loads", {
    method: "POST",
    body: JSON.stringify({ origin: "Should Be Blocked", destination: "Should Be Blocked" }),
  });
  check("maintenance_tech cannot create a load (write capability gate)", maintenanceWriteAttempt.status === 403);

  const complianceLogin = await login("compliance@test.com", "password123");
  const complianceToken = complianceLogin.body.token;
  const complianceLoadsRead = await authed(complianceToken, "/api/loads");
  check("compliance_officer can read loads", complianceLoadsRead.status === 200);
  const complianceWriteAttempt = await authed(complianceToken, "/api/loads", {
    method: "POST",
    body: JSON.stringify({ origin: "Should Be Blocked", destination: "Should Be Blocked" }),
  });
  check("compliance_officer cannot create a load (write capability gate)", complianceWriteAttempt.status === 403);

  // ── Cleanup: this script creates real rows over HTTP with no DELETE route
  // to undo them (FR-20 intentionally has none) — clean up directly so
  // repeated runs don't accumulate loads or trip unique/required constraints
  // for anyone adding a migration later.
  await prisma.loadStatusLog.deleteMany({ where: { loadId: { in: [loadId, editLoadId] } } });
  await prisma.load.deleteMany({ where: { id: { in: [loadId, editLoadId] } } });
  await prisma.$disconnect();

  console.log(`\n=== ${failures === 0 ? "All checks passed" : failures + " check(s) FAILED"} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
