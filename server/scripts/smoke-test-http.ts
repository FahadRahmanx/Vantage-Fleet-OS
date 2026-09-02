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

  // Declared here (not `const` inline) so the `finally` block below can
  // clean them up even if an earlier check throws — a partial run must
  // never leave rows an id-less deleteMany would later wipe indiscriminately.
  let loadId: string | undefined;
  let editLoadId: string | undefined;
  let newStatusId: string | undefined;
  let newTransitionId: string | undefined;

  try {

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
  loadId = created.body.id;

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

  const defaultAdvance = await authed(token, `/api/loads/${loadId}/advance`, {
    method: "POST",
    body: JSON.stringify({}), // no targetStatusId — should fall back to in_transit's default target
  });
  check("Advance with no targetStatusId falls back to the default transition", defaultAdvance.status === 200 && defaultAdvance.body.load.currentStatusId === statusMap.delivered.id);

  const reverted = await authed(token, `/api/loads/${loadId}/revert`, {
    method: "POST",
    body: JSON.stringify({ targetStatusId: statusMap.in_transit.id }),
  });
  check("Revert delivered → in_transit returns 200", reverted.status === 200);

  const detail = await authed(token, `/api/loads/${loadId}`);
  check("Load detail includes an audit trail", detail.status === 200 && Array.isArray(detail.body.statusLogs) && detail.body.statusLogs.length === 4);
  check("Advance rows are not marked reverted (FR-35)", detail.body.statusLogs[0]?.reverted === false && detail.body.statusLogs[1]?.reverted === false && detail.body.statusLogs[2]?.reverted === false);
  check("Revert row is marked reverted (FR-35)", detail.body.statusLogs[3]?.reverted === true);

  // ── Edit lock (FR-20): editable only while in Created status ──
  console.log("\n--- Edit lock ---");
  const editTestLoad = await authed(token, "/api/loads", {
    method: "POST",
    body: JSON.stringify({ origin: "Edit Test Origin", destination: "Edit Test Destination" }),
  });
  editLoadId = editTestLoad.body.id;

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
  const adminToken = adminLogin.body.token;

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

  // ── Workflow configuration (Phase 1, FR-23/24/25) ──
  console.log("\n--- Workflow configuration ---");
  const newStatus = await authed(adminToken, "/api/statuses", {
    method: "POST",
    body: JSON.stringify({ name: "Cancelled", code: "cancelled", position: 0 }),
  });
  check("POST /api/statuses (fleet_admin) returns 201", newStatus.status === 201 && newStatus.body.code === "cancelled");
  newStatusId = newStatus.body.id;

  const patchedStatus = await authed(adminToken, `/api/statuses/${newStatusId}`, {
    method: "PATCH",
    body: JSON.stringify({ color: "#888888" }),
  });
  check("PATCH /api/statuses/:id updates a field", patchedStatus.status === 200 && patchedStatus.body.color === "#888888");

  const secondDefaultStatus = await authed(adminToken, `/api/statuses/${newStatusId}`, {
    method: "PATCH",
    body: JSON.stringify({ isDefault: true }),
  });
  check("Marking a second status isDefault returns 400 (dispatch_statuses_one_default)", secondDefaultStatus.status === 400);

  const driverStatusAttempt = await authed(driver1Token, "/api/statuses", {
    method: "POST",
    body: JSON.stringify({ name: "Should Fail", code: "should_fail", position: 0 }),
  });
  check("driver cannot create a status (canConfigureWorkflow gate)", driverStatusAttempt.status === 403);

  const newTransition = await authed(adminToken, "/api/statuses/transitions", {
    method: "POST",
    body: JSON.stringify({ fromStatusId: statusMap.created.id, toStatusId: newStatusId }),
  });
  check("POST /api/statuses/transitions returns 201", newTransition.status === 201);
  newTransitionId = newTransition.body.id;

  // "created" already has a default-target edge to "assigned" (seeded in
  // Task 2's backfill). "created" -> "out_of_service" is a brand-new edge
  // (not seeded, not created above) so this specifically exercises the
  // dispatch_transitions_one_default_target partial unique index rather
  // than the plain @@unique([companyId, fromStatusId, toStatusId])
  // duplicate-edge constraint — reusing an existing (from,to) pair would
  // hit that constraint instead and prove nothing about the default-target
  // invariant specifically.
  const duplicateDefaultTarget = await authed(adminToken, "/api/statuses/transitions", {
    method: "POST",
    body: JSON.stringify({ fromStatusId: statusMap.created.id, toStatusId: statusMap.out_of_service.id, isDefaultTarget: true }),
  });
  check("Second default-target transition from the same status returns 400", duplicateDefaultTarget.status === 400);

  // ── Telematics ingestion (Phase 9, FR-47/48, mocked) ──
  console.log("\n--- Telematics ingestion ---");
  const TELEMATICS_KEY = "telematics-dev-key-vantage-freight"; // matches seed.ts

  const noKeyIngest = await fetch(`${BASE}/api/telematics/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vin: vehicle.vin, mileage: 1, engineHours: 1 }),
  });
  check("Telematics ingest with no token returns 401", noKeyIngest.status === 401);

  const wrongKeyIngest = await fetch(`${BASE}/api/telematics/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-key" },
    body: JSON.stringify({ vin: vehicle.vin, mileage: 1, engineHours: 1 }),
  });
  check("Telematics ingest with wrong key returns 401", wrongKeyIngest.status === 401);

  const goodIngest = await fetch(`${BASE}/api/telematics/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TELEMATICS_KEY}` },
    body: JSON.stringify({ vin: vehicle.vin, mileage: 54321, engineHours: 1200.5, timestamp: new Date().toISOString() }),
  });
  const goodIngestBody = await goodIngest.json();
  check("Telematics ingest with valid key + known VIN returns 200", goodIngest.status === 200 && goodIngestBody.odometer === 54321 && goodIngestBody.dataSource === "telematics_sync");

  const staleIngest = await fetch(`${BASE}/api/telematics/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TELEMATICS_KEY}` },
    body: JSON.stringify({ vin: vehicle.vin, mileage: 100, engineHours: 1201, timestamp: new Date().toISOString() }),
  });
  const staleIngestBody = await staleIngest.json();
  check("Stale (lower) mileage does not roll odometer backward", staleIngest.status === 200 && staleIngestBody.odometer === 54321);

  const unknownVinIngest = await fetch(`${BASE}/api/telematics/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TELEMATICS_KEY}` },
    body: JSON.stringify({ vin: "UNKNOWNVIN0000000", mileage: 1, engineHours: 1 }),
  });
  check("Unknown VIN returns 404", unknownVinIngest.status === 404);

  // ── HOS + eligibility preview (Phase 2, FR-22/26/40) ──
  console.log("\n--- HOS + eligibility preview ---");
  const availabilityCheck = await authed(token, `/api/duty-status/${eligibleDriver.id}/availability`);
  check("GET availability returns 200 with a numeric availableDriveHours", availabilityCheck.status === 200 && typeof availabilityCheck.body.availableDriveHours === "number");

  const dutyEntryPost = await authed(token, "/api/duty-status", {
    method: "POST",
    body: JSON.stringify({ driverId: eligibleDriver.id, dutyStatus: "driving", startedAt: new Date(Date.now() - 3600_000).toISOString(), endedAt: new Date().toISOString() }),
  });
  check("POST /api/duty-status returns 201", dutyEntryPost.status === 201);

  const dutyEntriesGet = await authed(token, `/api/duty-status?driverId=${eligibleDriver.id}`);
  check("GET /api/duty-status returns the entry list", dutyEntriesGet.status === 200 && Array.isArray(dutyEntriesGet.body) && dutyEntriesGet.body.length >= 1);

  const eligibilityPreview = await authed(token, `/api/drivers/${eligibleDriver.id}/eligibility?vehicleId=${vehicle.id}`);
  check("GET eligibility preview returns 200 with reasonCode", eligibilityPreview.status === 200 && eligibilityPreview.body.reasonCode === "ELIGIBLE");

  await prisma.dutyStatusEntry.deleteMany({ where: { id: dutyEntryPost.body.id } });

  } finally {
    // ── Cleanup: this script creates real rows over HTTP with no DELETE
    // route to undo them (FR-20 intentionally has none) — clean up directly
    // so repeated runs don't accumulate loads or trip unique/required
    // constraints. Runs even if an earlier check threw, and every id is
    // guarded — an undefined id passed to Prisma's `in`/equality filters is
    // "no filter", which would otherwise delete every row in the table.
    if (newTransitionId) await prisma.dispatchTransition.deleteMany({ where: { id: newTransitionId } });
    if (newStatusId) await prisma.dispatchStatus.deleteMany({ where: { id: newStatusId } });
    const loadIdsToClean = [loadId, editLoadId].filter((id): id is string => !!id);
    if (loadIdsToClean.length > 0) {
      await prisma.loadStatusLog.deleteMany({ where: { loadId: { in: loadIdsToClean } } });
      await prisma.load.deleteMany({ where: { id: { in: loadIdsToClean } } });
    }
    await prisma.$disconnect();
  }

  console.log(`\n=== ${failures === 0 ? "All checks passed" : failures + " check(s) FAILED"} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
