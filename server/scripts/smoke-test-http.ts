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
  let uploadId: string | undefined;
  let smokeUploadLoadId: string | undefined;
  let invitedUserId: string | undefined;
  let dashboardId: string | undefined;
  let documentId: string | undefined;

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
  check("GET /api/statuses returns the 6 seeded statuses", statuses.status === 200 && Object.keys(statusMap).length === 6);

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

  // ── DVIR submission (Phase 4, FR-28) ──
  console.log("\n--- DVIR submission ---");
  const dvirTestLoad = await authed(token, "/api/loads", {
    method: "POST",
    body: JSON.stringify({ origin: "DVIR Test Origin", destination: "DVIR Test Destination" }),
  });
  const dvirLoadId = dvirTestLoad.body.id;
  await authed(token, `/api/loads/${dvirLoadId}/assign`, {
    method: "POST",
    body: JSON.stringify({ driverId: eligibleDriver.id, vehicleId: vehicle.id }),
  });
  await authed(token, `/api/loads/${dvirLoadId}/advance`, {
    method: "POST",
    body: JSON.stringify({ targetStatusId: statusMap.assigned.id }),
  });

  const categoriesRes = await authed(token, "/api/defect-categories");
  check("GET /api/defect-categories returns 200", categoriesRes.status === 200 && Array.isArray(categoriesRes.body) && categoriesRes.body.length >= 3);

  const inspectionSubmit = await authed(token, "/api/inspections", {
    method: "POST",
    body: JSON.stringify({ loadId: dvirLoadId, vehicleId: vehicle.id, driverId: eligibleDriver.id, type: "pre_trip", defectEntries: [] }),
  });
  check("POST /api/inspections returns 201 with pass outcome + advanced load", inspectionSubmit.status === 201 && inspectionSubmit.body.inspection.overallOutcome === "pass" && inspectionSubmit.body.advance.load.currentStatusId === statusMap.in_transit.id);

  await prisma.inspectionDefect.deleteMany({ where: { inspection: { loadId: dvirLoadId } } });
  await prisma.inspection.deleteMany({ where: { loadId: dvirLoadId } });
  await prisma.loadStatusLog.deleteMany({ where: { loadId: dvirLoadId } });
  await prisma.load.deleteMany({ where: { id: dvirLoadId } });

  // ── Routes (Phase 5, FR-38) ──
  console.log("\n--- Route creation ---");
  const routeTestLoad = await authed(token, "/api/loads", {
    method: "POST",
    body: JSON.stringify({ origin: "Route Test Origin", destination: "Route Test Destination" }),
  });
  const routeLoadId = routeTestLoad.body.id;
  await authed(token, `/api/loads/${routeLoadId}/assign`, {
    method: "POST",
    body: JSON.stringify({ driverId: eligibleDriver.id, vehicleId: vehicle.id }),
  });
  await authed(token, `/api/loads/${routeLoadId}/advance`, {
    method: "POST",
    body: JSON.stringify({ targetStatusId: statusMap.assigned.id }),
  });

  const routeCreate = await authed(token, "/api/routes", {
    method: "POST",
    body: JSON.stringify({ loadIds: [routeLoadId] }),
  });
  check("POST /api/routes returns 201 and auto-advances the eligible load", routeCreate.status === 201 && routeCreate.body.autoAdvanced.includes(routeLoadId));

  const routesList = await authed(token, "/api/routes");
  check("GET /api/routes returns 200 with the created route", routesList.status === 200 && routesList.body.some((r: any) => r.id === routeCreate.body.route.id));

  await prisma.routeStop.deleteMany({ where: { routeId: routeCreate.body.route.id } });
  await prisma.route.deleteMany({ where: { id: routeCreate.body.route.id } });
  await prisma.loadStatusLog.deleteMany({ where: { loadId: routeLoadId } });
  await prisma.load.deleteMany({ where: { id: routeLoadId } });

  // ── Compliance Workbench (Phase 8, FR-41/42) ──
  console.log("\n--- Compliance finalization ---");
  const compTestLoad = await authed(token, "/api/loads", {
    method: "POST",
    body: JSON.stringify({ origin: "Compliance Test Origin", destination: "Compliance Test Destination" }),
  });
  const compLoadId = compTestLoad.body.id;
  await authed(token, `/api/loads/${compLoadId}/assign`, {
    method: "POST",
    body: JSON.stringify({ driverId: eligibleDriver.id, vehicleId: vehicle.id }),
  });
  await authed(token, `/api/loads/${compLoadId}/advance`, {
    method: "POST",
    body: JSON.stringify({ targetStatusId: statusMap.assigned.id }),
  });
  await authed(token, "/api/inspections", {
    method: "POST",
    body: JSON.stringify({ loadId: compLoadId, vehicleId: vehicle.id, driverId: eligibleDriver.id, type: "pre_trip", defectEntries: [] }),
  }); // pass -> auto-routes to in_transit
  await authed(token, `/api/loads/${compLoadId}/advance`, {
    method: "POST",
    body: JSON.stringify({ targetStatusId: statusMap.delivered.id }),
  });

  const compRouteCreate = await authed(token, "/api/routes", { method: "POST", body: JSON.stringify({ loadIds: [compLoadId] }) });
  const compRouteId = compRouteCreate.body.route.id;

  const complianceQueue = await authed(token, "/api/compliance/queue");
  check("GET /api/compliance/queue returns 200 and includes the route", complianceQueue.status === 200 && complianceQueue.body.some((r: any) => r.id === compRouteId));

  const complianceFinalize = await authed(adminToken, `/api/compliance/${compRouteId}/finalize`, { method: "POST" });
  check("POST /api/compliance/:routeId/finalize returns 201 with passCount 1", complianceFinalize.status === 201 && complianceFinalize.body.record.passCount === 1);

  const nonAdminFinalizeAttempt = await authed(token, `/api/compliance/${compRouteId}/finalize`, { method: "POST" });
  check("Non-compliance role finalize returns 403", nonAdminFinalizeAttempt.status === 403);

  await prisma.complianceRecord.deleteMany({ where: { routeId: compRouteId } });
  await prisma.routeStop.deleteMany({ where: { routeId: compRouteId } });
  await prisma.route.deleteMany({ where: { id: compRouteId } });
  await prisma.inspectionDefect.deleteMany({ where: { inspection: { loadId: compLoadId } } });
  await prisma.inspection.deleteMany({ where: { loadId: compLoadId } });
  await prisma.loadStatusLog.deleteMany({ where: { loadId: compLoadId } });
  await prisma.load.deleteMany({ where: { id: compLoadId } });

  // ── Audit History (Phase 10, FR-35) ──
  console.log("\n--- Audit History ---");
  const auditLog = await authed(token, "/api/audit");
  check("GET /api/audit returns 200 with an array", auditLog.status === 200 && Array.isArray(auditLog.body));

  // ── Bulk Load Importer (FR-44/45/46) ──
  console.log("\n--- Bulk Load Importer ---");

  const template = await fetch(`${BASE}/api/uploads/template`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  check(
    "GET /api/uploads/template returns an xlsx",
    template.status === 200 &&
      template.headers.get("content-type") === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );

  const noTokenTemplate = await fetch(`${BASE}/api/uploads/template`);
  check("GET /api/uploads/template with no token returns 401", noTokenTemplate.status === 401);

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Loads");
  sheet.addRow(["origin", "destination", "carrierName", "vehicleUnitNo", "driverName"]);
  sheet.addRow(["Smoke Origin", "Smoke Destination", "Northwind Owner-Operators", "1001", "Alice Eligible"]);
  const uploadBuffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer;

  const form = new FormData();
  form.append("mode", "standard");
  form.append("file", new Blob([uploadBuffer]), "smoke.xlsx");

  const uploadRes = await fetch(`${BASE}/api/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const uploadBody = await uploadRes.json();
  check("POST /api/uploads returns 201 with a validated upload", uploadRes.status === 201 && uploadBody.status === "validated");
  uploadId = uploadBody.id;

  if (uploadId) {
    const getUpload = await authed(token, `/api/uploads/${uploadId}`);
    check("GET /api/uploads/:id returns the rows", getUpload.status === 200 && Array.isArray(getUpload.body.rows) && getUpload.body.rows.length === 1);

    const confirmed = await authed(token, `/api/uploads/${uploadId}/confirm`, { method: "POST" });
    check("POST /api/uploads/:id/confirm returns 200 with one created load", confirmed.status === 200 && confirmed.body.createdLoadIds?.length === 1);
    smokeUploadLoadId = confirmed.body?.createdLoadIds?.[0];

    if (smokeUploadLoadId) {
      const filtered = await authed(token, `/api/loads?uploadId=${uploadId}`);
      check(
        "GET /api/loads?uploadId= filters to this upload's loads",
        filtered.status === 200 && filtered.body.length === 1 && filtered.body[0].id === smokeUploadLoadId
      );
    }
  }

  const noAuthUpload = await fetch(`${BASE}/api/uploads`, { method: "POST", body: new FormData() });
  check("POST /api/uploads with no token returns 401", noAuthUpload.status === 401);

  // ── Invitation Onboarding (FR-6/FR-7) ──
  console.log("\n--- Invitation Onboarding ---");

  const inviteRes = await authed(adminToken, "/api/users/invite", {
    method: "POST",
    body: JSON.stringify({ firstName: "Smoke", lastName: "Invitee", email: "smoke.invitee@test.com", role: "dispatcher" }),
  });
  check("POST /api/users/invite returns 201 with status invited", inviteRes.status === 201 && inviteRes.body.status === "invited");
  invitedUserId = inviteRes.body?.id;

  const dupInviteRes = await authed(adminToken, "/api/users/invite", {
    method: "POST",
    body: JSON.stringify({ firstName: "Dup", lastName: "Licate", email: "smoke.invitee@test.com", role: "dispatcher" }),
  });
  check("Duplicate-email invite returns 400", dupInviteRes.status === 400);

  const driverWriteAttemptInvite = await authed(driver1Token, "/api/users/invite", {
    method: "POST",
    body: JSON.stringify({ firstName: "Should", lastName: "Fail", email: "should.fail@test.com", role: "dispatcher" }),
  });
  check("driver cannot invite a user (canManageUsers gate)", driverWriteAttemptInvite.status === 403);

  const usersList = await authed(adminToken, "/api/users?status=invited");
  check("GET /api/users?status=invited includes the new invitee", usersList.status === 200 && usersList.body.some((u: any) => u.id === invitedUserId));

  const resendRes = await authed(adminToken, `/api/users/${invitedUserId}/resend-invite`, { method: "POST" });
  check("POST /api/users/:id/resend-invite returns 200", resendRes.status === 200);

  const patchRes = await authed(adminToken, `/api/users/${invitedUserId}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "fleet_admin" }),
  });
  check("PATCH /api/users/:id updates role", patchRes.status === 200 && patchRes.body.role === "fleet_admin");

  // Full invite -> accept -> login round trip.
  const inviteTokenRow = await prisma.inviteToken.findFirst({ where: { userId: invitedUserId }, orderBy: { createdAt: "desc" } });
  const previewRes = await fetch(`${BASE}/auth/invite/${inviteTokenRow!.token}`);
  const previewBody = await previewRes.json();
  check("GET /auth/invite/:token returns the invitee's email", previewRes.status === 200 && previewBody.email === "smoke.invitee@test.com");

  const acceptRes = await fetch(`${BASE}/auth/accept-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: inviteTokenRow!.token, password: "smoke-new-password" }),
  });
  const acceptBody = await acceptRes.json();
  check("POST /auth/accept-invite returns 200 with a token and active user", acceptRes.status === 200 && !!acceptBody.token && acceptBody.user.status === undefined /* not echoed, matches /auth/login's shape */);

  const reuseAcceptRes = await fetch(`${BASE}/auth/accept-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: inviteTokenRow!.token, password: "irrelevant" }),
  });
  check("Reusing an accepted token returns 410", reuseAcceptRes.status === 410);

  // ── Dashboard Builder (FR-49) ──
  console.log("\n--- Dashboard Builder ---");

  const dashboardsRes = await authed(token, "/api/dashboards");
  check("GET /api/dashboards returns personal/role/company", dashboardsRes.status === 200 && !!dashboardsRes.body.personal && !!dashboardsRes.body.role && !!dashboardsRes.body.company);
  dashboardId = dashboardsRes.body?.personal?.id;

  const patchDashboardRes = await authed(token, `/api/dashboards/${dashboardId}`, {
    method: "PATCH",
    body: JSON.stringify({ widgetKeys: ["active_loads", "loads_by_status"] }),
  });
  check("PATCH /api/dashboards/:id updates widgetKeys", patchDashboardRes.status === 200 && patchDashboardRes.body.widgetKeys.length === 2);

  const badWidgetRes = await authed(token, `/api/dashboards/${dashboardId}`, {
    method: "PATCH",
    body: JSON.stringify({ widgetKeys: ["not_a_widget"] }),
  });
  check("PATCH with an unknown widget key returns 400", badWidgetRes.status === 400);

  const dataRes = await authed(token, `/api/dashboards/${dashboardId}/data`);
  check(
    "GET /api/dashboards/:id/data returns shaped results for both widgets",
    dataRes.status === 200 && typeof dataRes.body.active_loads?.value === "number" && Array.isArray(dataRes.body.loads_by_status?.labels)
  );

  const roleDashboardRes = await authed(token, "/api/dashboards?role=fleet_admin");
  check("Non-admin ?role= override returns 403", roleDashboardRes.status === 403);

  const adminRoleDashboardRes = await authed(adminToken, "/api/dashboards?role=maintenance_tech");
  check("canManageDashboards ?role= override returns 200", adminRoleDashboardRes.status === 200 && adminRoleDashboardRes.body.role?.role === "maintenance_tech");

  const otherUserPersonalPatch = await authed(driver1Token, `/api/dashboards/${dashboardId}`, {
    method: "PATCH",
    body: JSON.stringify({ widgetKeys: [] }),
  });
  check("A different user cannot edit this personal dashboard", otherUserPersonalPatch.status === 403);

  // ── Load Documents (FR-21) ──
  console.log("\n--- Load Documents ---");

  const docForm = new FormData();
  docForm.append("type", "pod");
  docForm.append("file", new Blob([Buffer.from("fake pdf content")], { type: "application/pdf" }), "pod-scan.pdf");

  const docUploadRes = await fetch(`${BASE}/api/loads/${loadId}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: docForm,
  });
  const docUploadBody = await docUploadRes.json();
  check("POST /api/loads/:id/documents returns 201", docUploadRes.status === 201 && docUploadBody.type === "pod");
  documentId = docUploadBody?.id;

  const badTypeForm = new FormData();
  badTypeForm.append("type", "not_a_real_type");
  badTypeForm.append("file", new Blob([Buffer.from("x")], { type: "application/pdf" }), "x.pdf");
  const badTypeRes = await fetch(`${BASE}/api/loads/${loadId}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: badTypeForm,
  });
  check("POST with an invalid document type returns 400", badTypeRes.status === 400);

  const badMimeForm = new FormData();
  badMimeForm.append("type", "other");
  badMimeForm.append("file", new Blob([Buffer.from("not a real file")], { type: "text/plain" }), "notes.txt");
  const badMimeRes = await fetch(`${BASE}/api/loads/${loadId}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: badMimeForm,
  });
  check("POST with a disallowed mimetype returns 400", badMimeRes.status === 400);

  const docListRes = await authed(token, `/api/loads/${loadId}/documents`);
  check(
    "GET /api/loads/:id/documents returns the uploaded document with a url",
    docListRes.status === 200 && docListRes.body.length === 1 && typeof docListRes.body[0].url === "string" && docListRes.body[0].url.length > 0
  );

  const loadsListRes = await authed(token, "/api/loads");
  const listedLoad = loadsListRes.body.find((l: any) => l.id === loadId);
  check("GET /api/loads includes an accurate _count.documents", listedLoad?._count?.documents === 1);

  const driverDocUploadAttempt = await fetch(`${BASE}/api/loads/${loadId}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${driver1Token}` },
    body: (() => {
      const f = new FormData();
      f.append("type", "other");
      f.append("file", new Blob([Buffer.from("x")], { type: "application/pdf" }), "x.pdf");
      return f;
    })(),
  });
  check("driver cannot upload a document (canDispatchWrite gate)", driverDocUploadAttempt.status === 403);

  const docDeleteRes = await authed(token, `/api/loads/${loadId}/documents/${documentId}`, { method: "DELETE" });
  check("DELETE /api/loads/:id/documents/:docId returns 204", docDeleteRes.status === 204);

  const docListAfterDelete = await authed(token, `/api/loads/${loadId}/documents`);
  check("Document list is empty after delete", docListAfterDelete.status === 200 && docListAfterDelete.body.length === 0);
  documentId = undefined;

  // ── Settings Store (FR-55) ──
  console.log("\n--- Settings Store ---");

  const nonAdminSettingsRes = await authed(token, "/api/settings");
  check("fleet_admin without platformAdmin cannot read settings (platformAdmin-only gate)", nonAdminSettingsRes.status === 403);

  const adminSettingsRes = await authed(adminToken, "/api/settings");
  check("platformAdmin can read settings", adminSettingsRes.status === 200 && Array.isArray(adminSettingsRes.body));

  const putSettingRes = await authed(adminToken, "/api/settings/smoke_test_key", {
    method: "PUT",
    body: JSON.stringify({ value: "smoke-value" }),
  });
  check("PUT /api/settings/:key upserts a setting", putSettingRes.status === 200 && putSettingRes.body.value === "smoke-value");

  const putSettingAgainRes = await authed(adminToken, "/api/settings/smoke_test_key", {
    method: "PUT",
    body: JSON.stringify({ value: "smoke-value-updated" }),
  });
  check("PUT again updates the same row", putSettingAgainRes.status === 200 && putSettingAgainRes.body.id === putSettingRes.body.id && putSettingAgainRes.body.value === "smoke-value-updated");

  const nonAdminPutRes = await authed(token, "/api/settings/smoke_test_key", {
    method: "PUT",
    body: JSON.stringify({ value: "should-be-blocked" }),
  });
  check("fleet_admin without platformAdmin cannot write settings", nonAdminPutRes.status === 403);

  } finally {
    // ── Cleanup: this script creates real rows over HTTP with no DELETE
    // route to undo them (FR-20 intentionally has none) — clean up directly
    // so repeated runs don't accumulate loads or trip unique/required
    // constraints. Runs even if an earlier check threw, and every id is
    // guarded — an undefined id passed to Prisma's `in`/equality filters is
    // "no filter", which would otherwise delete every row in the table.
    if (newTransitionId) await prisma.dispatchTransition.deleteMany({ where: { id: newTransitionId } });
    if (newStatusId) await prisma.dispatchStatus.deleteMany({ where: { id: newStatusId } });
    if (uploadId) {
      await prisma.uploadRow.deleteMany({ where: { uploadId } });
      await prisma.upload.deleteMany({ where: { id: uploadId } });
    }
    if (invitedUserId) {
      await prisma.inviteToken.deleteMany({ where: { userId: invitedUserId } });
      await prisma.user.deleteMany({ where: { id: invitedUserId } });
    }
    if (documentId) {
      await prisma.loadDocument.deleteMany({ where: { id: documentId } });
    }
    const loadIdsToClean = [loadId, editLoadId, smokeUploadLoadId].filter((id): id is string => !!id);
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
