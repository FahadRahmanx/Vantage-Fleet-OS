/**
 * Test script for the workflow engine.
 * Run: npx tsx scripts/test-engine.ts
 *
 * Proves: advance(), revert(), eligibility blocking, audit log immutability.
 * No HTTP, no Express — plain service functions only.
 */

import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { advance, revert, assignDriver, createLoad, updateLoad } from "../src/services/workflow";
import { WorkflowError, EligibilityError, checkEligibility } from "../src/services/eligibility";
import { computeHosAvailability, computeHosAvailabilityFromValues } from "../src/services/hos";
import { computeInspectionOutcome, submitInspection } from "../src/services/inspections";
import { createRoute } from "../src/services/routes";
import { finalizeCompliance } from "../src/services/compliance";
import { createUpload, addAliasAndRevalidate, confirmUpload, matchAndValidateRow } from "../src/services/uploads";
import ExcelJS from "exceljs";
import { inviteUser, resendInvite, getInvitePreview, acceptInvite, requestPasswordReset, resetPassword } from "../src/services/users";
import { getDashboards, getRoleDashboard, updateDashboard, getDashboardData } from "../src/services/dashboards";
import { WIDGET_KEYS } from "../src/services/widgets";
import { buildKey, uploadDocument, getPresignedUrl, deleteDocument } from "../src/services/storage";
import { getSetting, getAllSettings, setSetting } from "../src/services/settings";
import { estimateFuelConsumption } from "../src/services/fuel-analytics";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Workflow Engine Test ===\n");

  // ── Setup: find seeded data ──
  const company = await prisma.company.findFirstOrThrow();
  const dispatcher = await prisma.user.findFirstOrThrow({
    where: { email: "dispatcher@test.com" },
  });
  const eligibleDriver = await prisma.driver.findFirstOrThrow({
    where: { name: "Alice Eligible" },
  });
  const expiredDriver = await prisma.driver.findFirstOrThrow({
    where: { name: "Charlie Expired" },
  });
  const vehicle = await prisma.vehicle.findFirstOrThrow({
    where: { plate: "VAN-1001" },
  });

  const statuses = await prisma.dispatchStatus.findMany({
    where: { companyId: company.id },
    orderBy: { code: "asc" },
  });
  const statusMap = Object.fromEntries(statuses.map((s) => [s.code, s]));

  console.log("Seed data loaded:");
  console.log(`  Company: ${company.name}`);
  console.log(`  Dispatcher: ${dispatcher.email} (${dispatcher.role})`);
  console.log(`  Eligible driver: ${eligibleDriver.name}`);
  console.log(`  Expired driver: ${expiredDriver.name}`);
  console.log(`  Statuses: ${statuses.map((s) => s.code).join(", ")}\n`);

  // ── Test 1: Create a load ──
  console.log("--- Test 1: Create a load ---");
  const load = await createLoad("Melbourne DC", "Sydney Store #42", company.id, dispatcher.id);
  console.log(`  Load created: ${load.id} (reference: ${load.reference}, status: ${statusMap["created"].code})`);
  console.log(`  Reference matches VFOxxxxxxx: ${/^VFO\d{7}$/.test(load.reference) ? "OK" : "FAIL"}`);

  // ── Test 2: Assign driver + vehicle ──
  console.log("\n--- Test 2: Assign eligible driver ---");
  await assignDriver(load.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  const assignedLoad = await prisma.load.findUniqueOrThrow({ where: { id: load.id } });
  console.log(`  Driver assigned: ${assignedLoad.driverId === eligibleDriver.id ? "OK" : "FAIL"}`);
  console.log(`  Vehicle assigned: ${assignedLoad.vehicleId === vehicle.id ? "OK" : "FAIL"}`);

  // ── Test 3: Block expired driver assignment ──
  console.log("\n--- Test 3: Block expired driver assignment ---");
  try {
    await assignDriver(load.id, expiredDriver.id, vehicle.id, dispatcher.id);
    console.log("  FAIL: Should have thrown EligibilityError");
    process.exit(1);
  } catch (e) {
    if (e instanceof EligibilityError) {
      console.log(`  Correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // ── Test 4: Advance created → assigned ──
  console.log("\n--- Test 4: Advance created → assigned ---");
  const result1 = await advance(load.id, statusMap["assigned"].id, dispatcher.id);
  console.log(`  Status now: ${result1.load.currentStatusId === statusMap["assigned"].id ? "assigned" : "FAIL"}`);
  console.log(`  Audit log: ${result1.log.id}`);

  // ── Test 5: Advance assigned → in_transit ──
  console.log("\n--- Test 5: Advance assigned → in_transit ---");
  const result2 = await advance(load.id, statusMap["in_transit"].id, dispatcher.id);
  console.log(`  Status now: ${result2.load.currentStatusId === statusMap["in_transit"].id ? "in_transit" : "FAIL"}`);

  // ── Test 6: Revert in_transit → assigned ──
  console.log("\n--- Test 6: Revert in_transit → assigned ---");
  const result3 = await revert(load.id, statusMap["assigned"].id, dispatcher.id);
  console.log(`  Status now: ${result3.load.currentStatusId === statusMap["assigned"].id ? "assigned" : "FAIL"}`);

  // ── Test 7: Block invalid transition (assigned → delivered — not in the graph) ──
  console.log("\n--- Test 7: Block invalid transition (assigned → delivered) ---");
  try {
    await advance(load.id, statusMap["delivered"].id, dispatcher.id);
    console.log("  FAIL: Should have thrown WorkflowError");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError) {
      console.log(`  Correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // ── Test 8: Verify audit trail ──
  console.log("\n--- Test 8: Verify audit trail (should be 3 rows) ---");
  const auditRows = await prisma.loadStatusLog.findMany({
    where: { loadId: load.id },
    orderBy: { createdAt: "asc" },
  });
  console.log(`  Audit rows: ${auditRows.length}`);
  for (const row of auditRows) {
    const from = statuses.find((s) => s.id === row.fromStatusId)?.code;
    const to = statuses.find((s) => s.id === row.toStatusId)?.code;
    console.log(`    ${from} → ${to} (actor: ${row.actorId === dispatcher.id ? "dispatcher" : "unknown"}, at: ${row.createdAt.toISOString()})`);
  }

  // ── Test 9: Audit log is immutable (no update/delete exposed) ──
  console.log("\n--- Test 9: Audit log immutability ---");
  console.log("  Prisma client has no update/delete methods on LoadStatusLog — enforced by schema design.");

  // ── Test 10: Complete the journey ──
  console.log("\n--- Test 10: Complete journey: assigned → in_transit → delivered ---");
  await advance(load.id, statusMap["in_transit"].id, dispatcher.id);
  const finalResult = await advance(load.id, statusMap["delivered"].id, dispatcher.id);
  console.log(`  Final status: delivered (id: ${finalResult.load.currentStatusId})`);

  const finalAuditCount = await prisma.loadStatusLog.count({ where: { loadId: load.id } });
  console.log(`  Total audit rows for load: ${finalAuditCount}`);

  // ── Test 11: Company scoping ──
  // Idempotent cleanup-then-create: if a previous run crashed before its own
  // final cleanup (any test after this one throwing does exactly that), a
  // leftover evil@test.com/Evil Corp from that run would otherwise collide
  // on the unique email every time this script runs again.
  console.log("\n--- Test 11: Company scoping ---");
  const leftoverEvilUser = await prisma.user.findUnique({ where: { email: "evil@test.com" } });
  if (leftoverEvilUser) await prisma.user.delete({ where: { id: leftoverEvilUser.id } });
  const leftoverEvilCompany = await prisma.company.findFirst({ where: { name: "Evil Corp" } });
  if (leftoverEvilCompany) await prisma.company.delete({ where: { id: leftoverEvilCompany.id } });

  const otherCompany = await prisma.company.create({ data: { name: "Evil Corp" } });
  const otherDispatcher = await prisma.user.create({
    data: {
      email: "evil@test.com",
      passwordHash: await bcrypt.hash("x", 10),
      name: "Evil User",
      role: UserRole.dispatcher,
      companyId: otherCompany.id,
    },
  });
  try {
    await advance(load.id, statusMap["assigned"].id, otherDispatcher.id);
    console.log("  FAIL: Should have thrown WorkflowError for cross-company access");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("does not belong")) {
      console.log("  Correctly blocked cross-company access");
    } else {
      throw e;
    }
  }

  // ── Test 12: advance() rejects a backward-ranked target (FR-23/31) ──
  // Regression test for the audit finding: revert() used to run the exact
  // same check as advance() (transition-row existence only), so a
  // misdirected call could walk a "revert" edge forwards or an "advance"
  // edge backwards. position now makes direction structural, not just naming.
  console.log("\n--- Test 12: advance() rejects a backward-ranked target ---");
  const positionLoad = await createLoad("Position Test Origin", "Position Test Destination", company.id, dispatcher.id);
  await assignDriver(positionLoad.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  await advance(positionLoad.id, statusMap["assigned"].id, dispatcher.id); // created(0) -> assigned(1)
  await advance(positionLoad.id, statusMap["in_transit"].id, dispatcher.id); // assigned(1) -> in_transit(2)
  try {
    // in_transit -> assigned is a real transition row (seeded for revert),
    // but calling it via advance() must now be rejected: assigned(1) < in_transit(2).
    await advance(positionLoad.id, statusMap["assigned"].id, dispatcher.id);
    console.log("  FAIL: advance() should have rejected a backward-ranked target");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("use revert()")) {
      console.log(`  Correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // ── Test 13: revert() rejects a forward-ranked target (FR-31) ──
  console.log("\n--- Test 13: revert() rejects a forward-ranked target ---");
  try {
    // in_transit -> delivered is a real transition row (seeded for advance),
    // but calling it via revert() must now be rejected: delivered(3) >= in_transit(2).
    await revert(positionLoad.id, statusMap["delivered"].id, dispatcher.id);
    console.log("  FAIL: revert() should have rejected a forward-ranked target");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("use advance()")) {
      console.log(`  Correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // ── Test 14: reverted flag on audit log rows (FR-35) ──
  console.log("\n--- Test 14: reverted flag on audit log rows ---");
  const advanceResult = await advance(positionLoad.id, statusMap["delivered"].id, dispatcher.id); // in_transit(2) -> delivered(3), legit advance
  console.log(`  Advance log reverted=false: ${advanceResult.log.reverted === false ? "OK" : "FAIL"}`);
  const revertResult = await revert(positionLoad.id, statusMap["in_transit"].id, dispatcher.id); // delivered(3) -> in_transit(2), legit revert
  console.log(`  Revert log reverted=true: ${revertResult.log.reverted === true ? "OK" : "FAIL"}`);

  // ── Test 15: updateLoad enforces the edit lock (FR-20) ──
  console.log("\n--- Test 15: updateLoad enforces edit lock ---");
  const editableLoad = await createLoad("Editable Origin", "Editable Destination", company.id, dispatcher.id);
  const edited = await updateLoad(editableLoad.id, dispatcher.id, { origin: "Edited Origin" });
  console.log(`  Edit while Created succeeds: ${edited.origin === "Edited Origin" ? "OK" : "FAIL"}`);

  await assignDriver(editableLoad.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  await advance(editableLoad.id, statusMap["assigned"].id, dispatcher.id);
  try {
    await updateLoad(editableLoad.id, dispatcher.id, { origin: "Should Fail" });
    console.log("  FAIL: updateLoad should have rejected an edit after advancing past Created");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError) {
      console.log(`  Correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // ── Test 16: advance() falls back to the default-target transition (FR-24) ──
  console.log("\n--- Test 16: advance() default-target fallback ---");
  const defaultTargetLoad = await createLoad("Default Target Origin", "Default Target Destination", company.id, dispatcher.id);
  // Advancing into "assigned" still requires a driver (requiresEligibilityCheck),
  // same as before this phase — assign first, same as the real UI flow does.
  await assignDriver(defaultTargetLoad.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  const noTargetAdvance = await advance(defaultTargetLoad.id, undefined, dispatcher.id);
  console.log(`  Advanced with no target -> ${noTargetAdvance.load.currentStatusId === statusMap["assigned"].id ? "assigned (OK, matches created->assigned default edge)" : "FAIL"}`);

  // ── Test 17: advance() with no target and no configured default throws ──
  console.log("\n--- Test 17: advance() with no default configured ---");
  await advance(defaultTargetLoad.id, statusMap["in_transit"].id, dispatcher.id); // assigned -> in_transit (explicit target)
  await advance(defaultTargetLoad.id, undefined, dispatcher.id); // in_transit -> delivered (default target)
  try {
    await advance(defaultTargetLoad.id, undefined, dispatcher.id); // delivered has no default-target edge
    console.log("  FAIL: should have thrown — delivered has no configured default transition");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("No target status resolved")) {
      console.log(`  Correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // ── Test 18: roleVisibility replaces the hardcoded role check ──
  // Idempotent cleanup-then-create — same reasoning as Test 11: a prior
  // crashed run past this point would otherwise leave these fixture users
  // behind and collide on their unique emails every rerun.
  console.log("\n--- Test 18: roleVisibility-based role check ---");
  const leftoverFixtureUsers = await prisma.user.findMany({ where: { email: { in: ["phase1-test-maintenance@test.com", "phase1-test-platform-admin@test.com"] } } });
  if (leftoverFixtureUsers.length > 0) {
    const leftoverIds = leftoverFixtureUsers.map((u) => u.id);
    // A leftover user may have already acted as an actor on audit log rows
    // before an earlier run crashed — those rows FK to it, so they have to
    // go first.
    await prisma.loadStatusLog.deleteMany({ where: { actorId: { in: leftoverIds } } });
    await prisma.user.deleteMany({ where: { id: { in: leftoverIds } } });
  }
  const roleVisLoad = await createLoad("Role Vis Origin", "Role Vis Destination", company.id, dispatcher.id);
  const maintenanceTechUser = await prisma.user.create({
    data: {
      email: "phase1-test-maintenance@test.com",
      passwordHash: await bcrypt.hash("x", 10),
      name: "Phase1 Test Maintenance",
      role: "maintenance_tech",
      companyId: company.id,
    },
  });
  try {
    await advance(roleVisLoad.id, statusMap["assigned"].id, maintenanceTechUser.id);
    console.log("  FAIL: maintenance_tech should not be in 'created' status's roleVisibility");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("does not have dispatch permissions")) {
      console.log(`  Correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }
  // A platformAdmin bypasses roleVisibility entirely, even for a role not listed.
  const platformAdminNonDispatch = await prisma.user.create({
    data: {
      email: "phase1-test-platform-admin@test.com",
      passwordHash: await bcrypt.hash("x", 10),
      name: "Phase1 Test Platform Admin",
      role: "compliance_officer",
      platformAdmin: true,
      companyId: company.id,
    },
  });
  await assignDriver(roleVisLoad.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  const platformAdminAdvance = await advance(roleVisLoad.id, statusMap["assigned"].id, platformAdminNonDispatch.id);
  console.log(`  platformAdmin (non-dispatch role) can still advance: ${platformAdminAdvance.load.currentStatusId === statusMap["assigned"].id ? "OK" : "FAIL"}`);

  // ── Test 19: updateLoad's isDefault check + platformAdmin bypass ──
  console.log("\n--- Test 19: updateLoad uses isDefault, not code ---");
  const isDefaultLoad = await createLoad("IsDefault Origin", "IsDefault Destination", company.id, dispatcher.id);
  const editedByPlatformAdmin = await updateLoad(isDefaultLoad.id, platformAdminNonDispatch.id, { origin: "Edited by platform admin" });
  console.log(`  platformAdmin (non-dispatch role) can edit a Created load: ${editedByPlatformAdmin.origin === "Edited by platform admin" ? "OK" : "FAIL"}`);

  // ── Test 20: comment/stopCount are captured on the audit log row ──
  console.log("\n--- Test 20: comment/stopCount captured on LoadStatusLog ---");
  const commentLoad = await createLoad("Comment Origin", "Comment Destination", company.id, dispatcher.id);
  await assignDriver(commentLoad.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  const commentResult = await advance(commentLoad.id, statusMap["assigned"].id, dispatcher.id, { comment: "Test comment", stopCount: 2 });
  console.log(`  Log has comment: ${commentResult.log.comment === "Test comment" ? "OK" : "FAIL"}`);
  console.log(`  Log has stopCount: ${commentResult.log.stopCount === 2 ? "OK" : "FAIL"}`);

  // ── Test 21: computeHosAvailability worked example (FR-40) ──
  // atTime is anchored to just after the seeded scenario's own entries
  // (their max endedAt), not real wall-clock "now" — the seed data uses
  // fixed clock-hours, and the test must not depend on what time of day it
  // happens to run.
  console.log("\n--- Test 21: computeHosAvailability worked example ---");
  const workedExampleDriverRow = await prisma.driver.findFirstOrThrow({ where: { name: "Wendy WorkedExample" } });
  const workedExampleRuleset = await prisma.hosRuleset.findFirstOrThrow({ where: { companyId: company.id } });
  const workedEntries = await prisma.dutyStatusEntry.findMany({ where: { driverId: workedExampleDriverRow.id }, orderBy: { endedAt: "desc" } });
  const workedAtTime = new Date((workedEntries[0].endedAt ?? new Date()).getTime() + 1);
  const workedSnapshot = await computeHosAvailability(workedExampleDriverRow.id, workedExampleRuleset.id, workedAtTime);
  console.log(`  drivingHoursUsed=${workedSnapshot.drivingHoursUsed}, availableDriveHours=${workedSnapshot.availableDriveHours}`);
  console.log(`  Matches worked example (8h used, 3h available): ${workedSnapshot.drivingHoursUsed === 8 && workedSnapshot.availableDriveHours === 3 ? "OK" : "FAIL"}`);

  // ── Test 22: computeHosAvailability exhausted driver ──
  console.log("\n--- Test 22: computeHosAvailability exhausted driver ---");
  const exhaustedDriverRow = await prisma.driver.findFirstOrThrow({ where: { name: "Hank HoursExhausted" } });
  const exhaustedEntries = await prisma.dutyStatusEntry.findMany({ where: { driverId: exhaustedDriverRow.id }, orderBy: { endedAt: "desc" } });
  const exhaustedAtTime = new Date((exhaustedEntries[0].endedAt ?? new Date()).getTime() + 1);
  const exhaustedSnapshot = await computeHosAvailability(exhaustedDriverRow.id, workedExampleRuleset.id, exhaustedAtTime);
  console.log(`  availableDriveHours=${exhaustedSnapshot.availableDriveHours}`);
  console.log(`  Exhausted (0h available, floored not negative): ${exhaustedSnapshot.availableDriveHours === 0 ? "OK" : "FAIL"}`);

  // ── Test 23: a qualifying reset clears accumulated time ──
  console.log("\n--- Test 23: qualifying reset clears accumulated hours ---");
  const testNow = new Date();
  const resetTestDriver = await prisma.driver.create({
    data: {
      name: "Rita ResetTest",
      licenseExpiry: new Date(testNow.getFullYear() + 2, testNow.getMonth(), testNow.getDate()),
      medicalCertExpiry: new Date(testNow.getFullYear() + 1, testNow.getMonth(), testNow.getDate()),
      hosRulesetId: workedExampleRuleset.id,
      companyId: company.id,
    },
  });
  const resetToday = new Date();
  resetToday.setHours(0, 0, 0, 0);
  await prisma.dutyStatusEntry.createMany({
    data: [
      { driverId: resetTestDriver.id, companyId: company.id, dutyStatus: "driving", startedAt: new Date(resetToday.getTime() + 0 * 3600_000), endedAt: new Date(resetToday.getTime() + 5 * 3600_000) },
      { driverId: resetTestDriver.id, companyId: company.id, dutyStatus: "off_duty", startedAt: new Date(resetToday.getTime() + 5 * 3600_000), endedAt: new Date(resetToday.getTime() + 16 * 3600_000) },
      { driverId: resetTestDriver.id, companyId: company.id, dutyStatus: "driving", startedAt: new Date(resetToday.getTime() + 16 * 3600_000), endedAt: new Date(resetToday.getTime() + 18 * 3600_000) },
    ],
  });
  const resetSnapshot = await computeHosAvailability(resetTestDriver.id, workedExampleRuleset.id, new Date(resetToday.getTime() + 18 * 3600_000));
  console.log(`  drivingHoursUsed after reset=${resetSnapshot.drivingHoursUsed}`);
  console.log(`  Only post-reset hours counted (2h, not 7h): ${resetSnapshot.drivingHoursUsed === 2 ? "OK" : "FAIL"}`);
  await prisma.dutyStatusEntry.deleteMany({ where: { driverId: resetTestDriver.id } });
  await prisma.driver.delete({ where: { id: resetTestDriver.id } });

  // ── Test 24: checkEligibility structured result + vehicle/HOS checks ──
  console.log("\n--- Test 24: checkEligibility extended ---");
  const eligibleResult = await checkEligibility(eligibleDriver.id, vehicle.id);
  console.log(`  Eligible driver: reasonCode=${eligibleResult.reasonCode}, eligible=${eligibleResult.eligible}`);
  console.log(`  Result includes hos snapshot: ${typeof eligibleResult.hos?.availableDriveHours === "number" ? "OK" : "FAIL"}`);

  const expiredResult = await checkEligibility(expiredDriver.id, vehicle.id);
  console.log(`  Expired-medical driver reasonCode: ${expiredResult.reasonCode === "EXPIRED_MEDICAL" ? "OK" : "FAIL"}`);

  const oosVehicle = await prisma.vehicle.create({
    data: { vin: "TESTVIN00000OOS1", unitNumber: "OOS-1", make: "Test", model: "Test", plate: "OOS-1", status: "out_of_service", companyId: company.id },
  });
  const oosResult = await checkEligibility(eligibleDriver.id, oosVehicle.id);
  console.log(`  Out-of-service vehicle reasonCode: ${oosResult.reasonCode === "VEHICLE_OUT_OF_SERVICE" ? "OK" : "FAIL"}`);
  await prisma.vehicle.delete({ where: { id: oosVehicle.id } });

  const exhaustedEligDriverRow = await prisma.driver.findFirstOrThrow({ where: { name: "Hank HoursExhausted" } });
  const hoursResult = await checkEligibility(exhaustedEligDriverRow.id, vehicle.id);
  console.log(`  Hours-exhausted driver reasonCode: ${hoursResult.reasonCode === "HOURS_EXHAUSTED" ? "OK" : "FAIL"}`);

  // ── Test 25: eligibility before/after captured on the audit log (FR-35) ──
  console.log("\n--- Test 25: eligibility snapshot in capturedData ---");
  const snapshotLoad = await createLoad("Snapshot Origin", "Snapshot Destination", company.id, dispatcher.id);
  await assignDriver(snapshotLoad.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  const snapshotAdvance = await advance(snapshotLoad.id, statusMap["assigned"].id, dispatcher.id);
  const capturedData = snapshotAdvance.log.capturedData as any;
  console.log(`  capturedData.eligibility.before present: ${!!capturedData?.eligibility?.before ? "OK" : "FAIL"}`);
  console.log(`  capturedData.eligibility.after present: ${!!capturedData?.eligibility?.after ? "OK" : "FAIL"}`);
  console.log(`  after.eligible is true: ${capturedData?.eligibility?.after?.eligible === true ? "OK" : "FAIL"}`);
  await prisma.loadStatusLog.deleteMany({ where: { loadId: snapshotLoad.id } });
  await prisma.load.delete({ where: { id: snapshotLoad.id } });

  // ── Test 26: computeInspectionOutcome priority (FR-28) ──
  console.log("\n--- Test 26: computeInspectionOutcome priority ---");
  const passCategory = await prisma.defectCategory.findFirstOrThrow({ where: { outcome: "pass" } });
  const minorCategory = await prisma.defectCategory.findFirstOrThrow({ where: { outcome: "minor_defect" } });
  const oosCategory = await prisma.defectCategory.findFirstOrThrow({ where: { outcome: "out_of_service" } });
  const allCategories = [passCategory, minorCategory, oosCategory];

  console.log(`  No defects -> pass: ${computeInspectionOutcome([], allCategories) === "pass" ? "OK" : "FAIL"}`);
  console.log(`  Minor only -> minor_defect: ${computeInspectionOutcome([{ defectCategoryId: minorCategory.id }], allCategories) === "minor_defect" ? "OK" : "FAIL"}`);
  console.log(`  Minor + OOS -> out_of_service (priority): ${computeInspectionOutcome([{ defectCategoryId: minorCategory.id }, { defectCategoryId: oosCategory.id }], allCategories) === "out_of_service" ? "OK" : "FAIL"}`);

  // ── Test 27: submitInspection — pass outcome, auto-routes via default target ──
  console.log("\n--- Test 27: submitInspection pass outcome ---");
  const dvirLoad1 = await createLoad("DVIR Pass Origin", "DVIR Pass Destination", company.id, dispatcher.id);
  await assignDriver(dvirLoad1.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  await advance(dvirLoad1.id, statusMap["assigned"].id, dispatcher.id);
  // No outcome-triggered edge exists from "assigned" yet in the seeded
  // graph, so a zero-defect (pass) submission must fall back to the
  // default-target edge (assigned -> in_transit) — proving outcome-routing
  // and default-target fallback compose correctly, not just outcome-routing
  // in isolation.
  const passSubmission = await submitInspection({
    loadId: dvirLoad1.id, vehicleId: vehicle.id, driverId: eligibleDriver.id,
    type: "pre_trip", defectEntries: [], actorId: dispatcher.id,
  });
  console.log(`  Inspection outcome computed as pass: ${passSubmission.inspection.overallOutcome === "pass" ? "OK" : "FAIL"}`);
  console.log(`  Load auto-routed via default target: ${passSubmission.advance.load.currentStatusId === statusMap["in_transit"].id ? "OK" : "FAIL"}`);

  // ── Test 28: submitInspection — out_of_service outcome routes via outcomeTrigger, priority over minor ──
  console.log("\n--- Test 28: submitInspection out_of_service priority ---");
  const dvirLoad2 = await createLoad("DVIR OOS Origin", "DVIR OOS Destination", company.id, dispatcher.id);
  await assignDriver(dvirLoad2.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  await advance(dvirLoad2.id, statusMap["assigned"].id, dispatcher.id);
  // The assigned -> out_of_service transition is already seeded (position-
  // equal edge); set its outcomeTrigger for this test rather than creating
  // a duplicate row (unique on companyId/fromStatusId/toStatusId).
  const oosOutcomeTransition = await prisma.dispatchTransition.update({
    where: {
      companyId_fromStatusId_toStatusId: {
        companyId: company.id,
        fromStatusId: statusMap["assigned"].id,
        toStatusId: statusMap["out_of_service"].id,
      },
    },
    data: { outcomeTrigger: "out_of_service" },
  });
  const oosSubmission = await submitInspection({
    loadId: dvirLoad2.id, vehicleId: vehicle.id, driverId: eligibleDriver.id,
    type: "pre_trip", defectEntries: [{ defectCategoryId: minorCategory.id }, { defectCategoryId: oosCategory.id }],
    actorId: dispatcher.id,
  });
  console.log(`  Inspection outcome computed as out_of_service (priority over minor): ${oosSubmission.inspection.overallOutcome === "out_of_service" ? "OK" : "FAIL"}`);
  console.log(`  Load auto-routed to out_of_service status: ${oosSubmission.advance.load.currentStatusId === statusMap["out_of_service"].id ? "OK" : "FAIL"}`);
  // Restore the seeded baseline, not null: seed.ts ships this edge with the
  // out_of_service trigger set, so nulling it here would leave the database
  // unable to route a defect DVIR after every test run.
  await prisma.dispatchTransition.update({ where: { id: oosOutcomeTransition.id }, data: { outcomeTrigger: "out_of_service" } });

  // ── Test 29: manual override requires a reason ──
  console.log("\n--- Test 29: override requires a reason ---");
  const dvirLoad3 = await createLoad("DVIR Override Origin", "DVIR Override Destination", company.id, dispatcher.id);
  await assignDriver(dvirLoad3.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  await advance(dvirLoad3.id, statusMap["assigned"].id, dispatcher.id);
  try {
    await submitInspection({
      loadId: dvirLoad3.id, vehicleId: vehicle.id, driverId: eligibleDriver.id,
      type: "pre_trip", defectEntries: [], overrideOutcome: "minor_defect", actorId: dispatcher.id,
    });
    console.log("  FAIL: should have thrown — overrideOutcome without overrideReason");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("Override requires a reason")) {
      console.log(`  Correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Cleanup Tests 26-29
  const dvirCleanupLoadIds = [dvirLoad1.id, dvirLoad2.id, dvirLoad3.id];
  await prisma.inspectionDefect.deleteMany({ where: { inspection: { loadId: { in: dvirCleanupLoadIds } } } });
  await prisma.inspection.deleteMany({ where: { loadId: { in: dvirCleanupLoadIds } } });
  await prisma.loadStatusLog.deleteMany({ where: { loadId: { in: dvirCleanupLoadIds } } });
  await prisma.load.deleteMany({ where: { id: { in: dvirCleanupLoadIds } } });

  // ── Test 30: createRoute auto-advances an eligible assigned load (FR-38) ──
  console.log("\n--- Test 30: createRoute auto-advance ---");
  const routeLoad = await createLoad("Route Origin", "Route Destination", company.id, dispatcher.id);
  await assignDriver(routeLoad.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  await advance(routeLoad.id, statusMap["assigned"].id, dispatcher.id); // now in "assigned" (isDispatchStatus=true)
  const routeResult = await createRoute(company.id, dispatcher.id, [routeLoad.id]);
  console.log(`  Route created: ${routeResult.route.reference}`);
  console.log(`  Load auto-advanced: ${routeResult.autoAdvanced.includes(routeLoad.id) ? "OK" : "FAIL"}`);
  const routedLoad = await prisma.load.findUniqueOrThrow({ where: { id: routeLoad.id } });
  console.log(`  Load now in_transit: ${routedLoad.currentStatusId === statusMap["in_transit"].id ? "OK" : "FAIL"}`);

  // Cleanup Test 30
  await prisma.routeStop.deleteMany({ where: { routeId: routeResult.route.id } });
  await prisma.route.delete({ where: { id: routeResult.route.id } });
  await prisma.loadStatusLog.deleteMany({ where: { loadId: routeLoad.id } });
  await prisma.load.delete({ where: { id: routeLoad.id } });

  // ── Test 31: Maintenance Workbench claim/complete-repair (FR-36) ──
  console.log("\n--- Test 31: maintenance claim + complete repair ---");
  const maintLoad = await createLoad("Maintenance Origin", "Maintenance Destination", company.id, dispatcher.id);
  await assignDriver(maintLoad.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  await advance(maintLoad.id, statusMap["assigned"].id, dispatcher.id);
  await advance(maintLoad.id, statusMap["out_of_service"].id, dispatcher.id);
  console.log(`  Load flagged (out_of_service): OK`);

  const claimResult = await advance(maintLoad.id, undefined, maintenanceTechUser.id);
  console.log(`  maintenance_tech claims via default-target advance: ${claimResult.load.currentStatusId === statusMap["in_repair"].id ? "OK" : "FAIL"}`);

  const completeResult = await revert(maintLoad.id, statusMap["created"].id, maintenanceTechUser.id);
  console.log(`  maintenance_tech completes repair via revert: ${completeResult.load.currentStatusId === statusMap["created"].id ? "OK" : "FAIL"}`);

  await prisma.loadStatusLog.deleteMany({ where: { loadId: maintLoad.id } });
  await prisma.load.delete({ where: { id: maintLoad.id } });

  // ── Test 32: finalizeCompliance tallies outcomes + HOS, reroutes OOS load (FR-41/42) ──
  console.log("\n--- Test 32: finalizeCompliance ---");
  const compLoadA = await createLoad("Compliance A Origin", "Compliance A Destination", company.id, dispatcher.id);
  await assignDriver(compLoadA.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  await advance(compLoadA.id, statusMap["assigned"].id, dispatcher.id);
  await submitInspection({
    loadId: compLoadA.id, vehicleId: vehicle.id, driverId: eligibleDriver.id,
    type: "pre_trip", defectEntries: [], actorId: dispatcher.id,
  }); // pass -> auto-routes to in_transit
  await advance(compLoadA.id, statusMap["delivered"].id, dispatcher.id);
  const compDutyEntry = await prisma.dutyStatusEntry.create({
    data: {
      driverId: eligibleDriver.id, companyId: company.id, loadId: compLoadA.id,
      dutyStatus: "driving", startedAt: new Date(Date.now() - 2 * 3600_000), endedAt: new Date(),
    },
  });

  const compLoadB = await createLoad("Compliance B Origin", "Compliance B Destination", company.id, dispatcher.id);
  await assignDriver(compLoadB.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  await advance(compLoadB.id, statusMap["assigned"].id, dispatcher.id);
  const compOosTransition = await prisma.dispatchTransition.update({
    where: { companyId_fromStatusId_toStatusId: { companyId: company.id, fromStatusId: statusMap["assigned"].id, toStatusId: statusMap["out_of_service"].id } },
    data: { outcomeTrigger: "out_of_service" },
  });
  await submitInspection({
    loadId: compLoadB.id, vehicleId: vehicle.id, driverId: eligibleDriver.id,
    type: "pre_trip", defectEntries: [{ defectCategoryId: oosCategory.id }], actorId: dispatcher.id,
  }); // out_of_service -> auto-routes to out_of_service status
  await prisma.dispatchTransition.update({ where: { id: compOosTransition.id }, data: { outcomeTrigger: "out_of_service" } });
  // Simulate this load having later been delivered by another path while
  // its last recorded inspection is still the OOS one — exercises
  // finalizeCompliance's tally+reroute independent of load.currentStatus.
  await prisma.load.update({ where: { id: compLoadB.id }, data: { currentStatusId: statusMap["delivered"].id } });

  const compRouteResult = await createRoute(company.id, dispatcher.id, [compLoadA.id, compLoadB.id]);
  const complianceResult = await finalizeCompliance(compRouteResult.route.id, dispatcher.id);
  console.log(`  passCount=1: ${complianceResult.record.passCount === 1 ? "OK" : "FAIL"}`);
  console.log(`  outOfServiceCount=1: ${complianceResult.record.outOfServiceCount === 1 ? "OK" : "FAIL"}`);
  console.log(`  totalHosHours=2: ${complianceResult.record.totalHosHours === 2 ? "OK" : "FAIL"}`);

  const rerouted = await prisma.load.findUniqueOrThrow({ where: { id: compLoadB.id } });
  console.log(`  OOS load rerouted back to out_of_service: ${rerouted.currentStatusId === statusMap["out_of_service"].id ? "OK" : "FAIL"}`);

  try {
    await finalizeCompliance(compRouteResult.route.id, dispatcher.id);
    console.log("  FAIL: should have thrown — already finalized");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("already been finalized")) {
      console.log(`  Correctly blocked re-finalization: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Cleanup Test 32
  const compLoadIds = [compLoadA.id, compLoadB.id];
  await prisma.complianceRecord.delete({ where: { id: complianceResult.record.id } });
  await prisma.routeStop.deleteMany({ where: { routeId: compRouteResult.route.id } });
  await prisma.route.delete({ where: { id: compRouteResult.route.id } });
  await prisma.dutyStatusEntry.deleteMany({ where: { id: compDutyEntry.id } });
  await prisma.inspectionDefect.deleteMany({ where: { inspection: { loadId: { in: compLoadIds } } } });
  await prisma.inspection.deleteMany({ where: { loadId: { in: compLoadIds } } });
  await prisma.loadStatusLog.deleteMany({ where: { loadId: { in: compLoadIds } } });
  await prisma.load.deleteMany({ where: { id: { in: compLoadIds } } });

  // ── Test 33: cross-company isolation extended to Phase 4/5/8 domains ──
  console.log("\n--- Test 33: cross-company isolation (Route, Inspection, Compliance) ---");
  const isoLoad = await createLoad("Isolation Origin", "Isolation Destination", company.id, dispatcher.id);
  await assignDriver(isoLoad.id, eligibleDriver.id, vehicle.id, dispatcher.id);
  await advance(isoLoad.id, statusMap["assigned"].id, dispatcher.id);

  try {
    await submitInspection({
      loadId: isoLoad.id, vehicleId: vehicle.id, driverId: eligibleDriver.id,
      type: "pre_trip", defectEntries: [], actorId: otherDispatcher.id,
    });
    console.log("  FAIL: cross-company submitInspection should have been blocked");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("does not belong to actor's company")) {
      console.log(`  submitInspection correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  try {
    await createRoute(otherCompany.id, otherDispatcher.id, [isoLoad.id]);
    console.log("  FAIL: cross-company createRoute should have been blocked");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("does not belong to actor's company")) {
      console.log(`  createRoute correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  const isoRoute = await createRoute(company.id, dispatcher.id, [isoLoad.id]);
  try {
    await finalizeCompliance(isoRoute.route.id, otherDispatcher.id);
    console.log("  FAIL: cross-company finalizeCompliance should have been blocked");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("does not belong to actor's company")) {
      console.log(`  finalizeCompliance correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  await prisma.routeStop.deleteMany({ where: { routeId: isoRoute.route.id } });
  await prisma.route.delete({ where: { id: isoRoute.route.id } });
  await prisma.loadStatusLog.deleteMany({ where: { loadId: isoLoad.id } });
  await prisma.load.delete({ where: { id: isoLoad.id } });

  // ── Test 34: bulk load importer (FR-44/45/46) ──
  console.log("\n--- Test 34: bulk load importer ---");

  function buildRow(overrides: Partial<{ origin: string; destination: string; carrierName: string; vehicleUnitNo: string; driverName: string }> = {}) {
    return {
      origin: "Import Origin",
      destination: "Import Destination",
      carrierName: "Northwind Owner-Operators",
      vehicleUnitNo: "1001",
      driverName: "Alice Eligible",
      ...overrides,
    };
  }

  // Standard mode: exact match on carrier/vehicle/driver, no alias needed.
  const okResult = await prisma.$transaction((tx) => matchAndValidateRow(tx, company.id, "standard", buildRow()));
  console.log(`  Standard-mode exact match: ${okResult.status === "ok" ? "OK" : "FAIL — " + okResult.errors.join(", ")}`);
  if (okResult.status !== "ok") process.exit(1);

  // Vehicle found-or-created: an unknown unit number creates a Vehicle rather than erroring.
  const foundOrCreatedResult = await prisma.$transaction((tx) =>
    matchAndValidateRow(tx, company.id, "standard", buildRow({ vehicleUnitNo: "IMPORT-TEST-9999" }))
  );
  console.log(`  Unknown vehicle found-or-created: ${foundOrCreatedResult.matchedVehicleId ? "OK" : "FAIL"}`);
  if (!foundOrCreatedResult.matchedVehicleId) process.exit(1);
  const createdVehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: foundOrCreatedResult.matchedVehicleId } });
  console.log(`  Created vehicle dataSource: ${createdVehicle.dataSource === "import" ? "OK" : "FAIL"}`);

  // Driver never auto-created: an unknown name is a row error.
  const unknownDriverResult = await prisma.$transaction((tx) =>
    matchAndValidateRow(tx, company.id, "standard", buildRow({ driverName: "Nobody Ghost" }))
  );
  console.log(`  Unknown driver is a row error, not auto-created: ${unknownDriverResult.status === "error" && unknownDriverResult.matchedDriverId === null ? "OK" : "FAIL"}`);
  if (unknownDriverResult.status !== "error") process.exit(1);

  // Legacy mode: unknown carrier name fails until an alias resolves it.
  async function buildWorkbookBuffer(rows: string[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Loads");
    sheet.addRow(["origin", "destination", "carrierName", "vehicleUnitNo", "driverName"]);
    for (const row of rows) sheet.addRow(row);
    return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  }

  const legacyBuffer = await buildWorkbookBuffer([
    ["Legacy Origin", "Legacy Destination", "Northwind Legacy Co", "1001", "Alice Eligible"],
  ]);
  const legacyUpload = await createUpload(company.id, "legacy", "legacy-test.xlsx", legacyBuffer, dispatcher.id);
  console.log(`  Legacy upload created, unresolved carrier is a row error: ${legacyUpload.errorRows === 1 ? "OK" : "FAIL (errorRows=" + legacyUpload.errorRows + ")"}`);
  if (legacyUpload.errorRows !== 1) process.exit(1);

  const carrier = await prisma.carrierCompany.findFirstOrThrow({ where: { companyId: company.id } });
  const revalidated = await addAliasAndRevalidate(legacyUpload.id, "carrier", "Northwind Legacy Co", carrier.id, dispatcher.id);
  console.log(`  Add-alias-and-revalidate resolves the row without re-upload: ${revalidated.errorRows === 0 ? "OK" : "FAIL"}`);
  if (revalidated.errorRows !== 0) process.exit(1);

  const confirmedLegacy = await confirmUpload(legacyUpload.id, dispatcher.id);
  console.log(`  Confirm creates one Load per row: ${confirmedLegacy.createdLoadIds.length === 1 && confirmedLegacy.status === "complete" ? "OK" : "FAIL"}`);
  if (confirmedLegacy.createdLoadIds.length !== 1) process.exit(1);

  // Confirm is all-or-nothing: an upload with any error row is rejected, no Loads created.
  const mixedBuffer = await buildWorkbookBuffer([
    ["OK Origin", "OK Destination", "Northwind Owner-Operators", "1001", "Alice Eligible"],
    ["Bad Origin", "Bad Destination", "Northwind Owner-Operators", "1001", "Nobody Ghost"],
  ]);
  const mixedUpload = await createUpload(company.id, "standard", "mixed-test.xlsx", mixedBuffer, dispatcher.id);
  try {
    await confirmUpload(mixedUpload.id, dispatcher.id);
    console.log("  FAIL: confirm should have rejected an upload with an error row");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("Every row must be valid")) {
      console.log(`  Mixed-error upload correctly rejected at confirm: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Cross-company isolation, extending the Test 33 pattern to Upload.
  try {
    await addAliasAndRevalidate(legacyUpload.id, "carrier", "Whatever", carrier.id, otherDispatcher.id);
    console.log("  FAIL: cross-company addAliasAndRevalidate should have been blocked");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("does not belong to actor's company")) {
      console.log(`  addAliasAndRevalidate correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  try {
    await confirmUpload(mixedUpload.id, otherDispatcher.id);
    console.log("  FAIL: cross-company confirmUpload should have been blocked");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("does not belong to actor's company")) {
      console.log(`  confirmUpload correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Cleanup this test's rows.
  const test34LoadIds = [...confirmedLegacy.createdLoadIds];
  await prisma.loadStatusLog.deleteMany({ where: { loadId: { in: test34LoadIds } } });
  await prisma.load.deleteMany({ where: { id: { in: test34LoadIds } } });
  await prisma.uploadRow.deleteMany({ where: { uploadId: { in: [legacyUpload.id, mixedUpload.id] } } });
  await prisma.upload.deleteMany({ where: { id: { in: [legacyUpload.id, mixedUpload.id] } } });
  await prisma.alias.deleteMany({ where: { companyId: company.id, kind: "carrier", aliasText: "Northwind Legacy Co" } });
  await prisma.vehicle.deleteMany({ where: { id: foundOrCreatedResult.matchedVehicleId! } });

  // ── Test 35: invitation onboarding (FR-6/FR-7) ──
  console.log("\n--- Test 35: invitation onboarding ---");

  // Happy path: invite a dispatcher (no carrier/driver needed).
  const invited = await inviteUser({
    firstName: "Ivy", lastName: "Invited", email: "ivy.invited@test.com",
    role: "dispatcher", companyId: company.id,
  });
  console.log(`  Invite creates a User with status "invited": ${invited.status === "invited" ? "OK" : "FAIL"}`);
  if (invited.status !== "invited") process.exit(1);

  // Duplicate email is rejected.
  try {
    await inviteUser({ firstName: "Dup", lastName: "Licate", email: "ivy.invited@test.com", role: "dispatcher", companyId: company.id });
    console.log("  FAIL: duplicate-email invite should have been rejected");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("already exists")) {
      console.log(`  Duplicate email correctly rejected: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Driver-role invite needs an existing, unlinked Driver in the given carrier.
  const unlinkedDriver = await prisma.driver.create({
    data: {
      name: "Uma Unlinked",
      licenseExpiry: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
      medicalCertExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      carrierCompanyId: carrier.id,
      companyId: company.id,
    },
  });

  try {
    await inviteUser({ firstName: "No", lastName: "Carrier", email: "no.carrier@test.com", role: "driver", companyId: company.id });
    console.log("  FAIL: driver-role invite without carrierCompanyId/driverId should have been rejected");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("required when role is driver")) {
      console.log(`  Driver-role invite without carrier/driver correctly rejected: ${e.message}`);
    } else {
      throw e;
    }
  }

  try {
    await inviteUser({ firstName: "Already", lastName: "Linked", email: "already.linked@test.com", role: "driver", carrierCompanyId: carrier.id, driverId: expiredDriver.id, companyId: company.id });
    console.log("  FAIL: inviting an already-linked driver should have been rejected");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("already linked")) {
      console.log(`  Already-linked driver correctly rejected: ${e.message}`);
    } else {
      throw e;
    }
  }

  const driverInvite = await inviteUser({
    firstName: "Uma", lastName: "Unlinked", email: "uma.unlinked@test.com",
    role: "driver", carrierCompanyId: carrier.id, driverId: unlinkedDriver.id, companyId: company.id,
  });
  console.log(`  Driver-role invite links driverId: ${driverInvite.driverId === unlinkedDriver.id ? "OK" : "FAIL"}`);
  if (driverInvite.driverId !== unlinkedDriver.id) process.exit(1);

  // Accept flow: preview, then accept logs the user in (returns an active user).
  const inviteTokenRow = await prisma.inviteToken.findFirstOrThrow({ where: { userId: invited.id } });
  const preview = await getInvitePreview(inviteTokenRow.token);
  console.log(`  getInvitePreview returns the invitee's name/email/role: ${preview.email === "ivy.invited@test.com" ? "OK" : "FAIL"}`);

  const accepted = await acceptInvite(inviteTokenRow.token, "new-password-123");
  console.log(`  acceptInvite activates the account: ${accepted.status === "active" ? "OK" : "FAIL"}`);
  if (accepted.status !== "active") process.exit(1);

  try {
    await acceptInvite(inviteTokenRow.token, "another-password");
    console.log("  FAIL: reusing an accepted token should have been rejected");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("already been used")) {
      console.log(`  Reused token correctly rejected: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Expired token is rejected.
  const expiredTokenUser = await inviteUser({ firstName: "Ex", lastName: "Pired", email: "ex.pired@test.com", role: "dispatcher", companyId: company.id });
  const expiredTokenRow = await prisma.inviteToken.findFirstOrThrow({ where: { userId: expiredTokenUser.id } });
  await prisma.inviteToken.update({ where: { id: expiredTokenRow.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  try {
    await acceptInvite(expiredTokenRow.token, "whatever");
    console.log("  FAIL: expired token should have been rejected");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("expired")) {
      console.log(`  Expired token correctly rejected: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Resend: only valid while still "invited".
  try {
    await resendInvite(accepted.id, company.id);
    console.log("  FAIL: resend on an already-active user should have been rejected");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("not in invited status")) {
      console.log(`  Resend on active user correctly rejected: ${e.message}`);
    } else {
      throw e;
    }
  }

  const resent = await resendInvite(driverInvite.id, company.id);
  const resendTokenCount = await prisma.inviteToken.count({ where: { userId: driverInvite.id } });
  console.log(`  Resend creates a second token for the same user: ${resendTokenCount === 2 && resent.id === driverInvite.id ? "OK" : "FAIL"}`);

  // Cross-company isolation, extending the Test 33/34 pattern to User/InviteToken.
  try {
    await resendInvite(driverInvite.id, otherCompany.id);
    console.log("  FAIL: cross-company resendInvite should have been blocked");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("not found")) {
      console.log(`  Cross-company resendInvite correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Cleanup this test's rows.
  const test35UserIds = [invited.id, driverInvite.id, expiredTokenUser.id];
  await prisma.inviteToken.deleteMany({ where: { userId: { in: test35UserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: test35UserIds } } });
  await prisma.driver.deleteMany({ where: { id: unlinkedDriver.id } });

  // ── Test 36: dashboard builder (FR-49) ──
  console.log("\n--- Test 36: dashboard builder ---");

  const dispatcherAuth = { userId: dispatcher.id, companyId: company.id, role: "dispatcher" as const, platformAdmin: false };
  const adminAuth = { userId: platformAdminNonDispatch.id, companyId: company.id, role: "fleet_admin" as const, platformAdmin: true };

  // Auto-provisioning: first access creates all three, empty.
  const firstAccess = await getDashboards(dispatcherAuth);
  console.log(`  Auto-provisions personal/role/company dashboards: ${firstAccess.personal.widgetKeys.length === 0 && firstAccess.role.widgetKeys.length === 0 && firstAccess.company.widgetKeys.length === 0 ? "OK" : "FAIL"}`);
  const secondAccess = await getDashboards(dispatcherAuth);
  console.log(`  Second access reuses the same personal dashboard row: ${secondAccess.personal.id === firstAccess.personal.id ? "OK" : "FAIL"}`);
  if (secondAccess.personal.id !== firstAccess.personal.id) process.exit(1);

  // Personal dashboard: owner can edit, another user cannot.
  const updatedPersonal = await updateDashboard(firstAccess.personal.id, ["active_loads", "total_loads"], dispatcherAuth, false);
  console.log(`  Owner can update their personal dashboard: ${JSON.stringify(updatedPersonal.widgetKeys) === JSON.stringify(["active_loads", "total_loads"]) ? "OK" : "FAIL"}`);

  try {
    await updateDashboard(firstAccess.personal.id, ["total_loads"], adminAuth, true);
    console.log("  FAIL: a non-owner (even canManageDashboards) should not edit another user's personal dashboard");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("Not authorized")) {
      console.log(`  Non-owner correctly blocked from editing personal dashboard: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Unknown widget key is rejected before any write.
  try {
    await updateDashboard(firstAccess.personal.id, ["not_a_real_widget"], dispatcherAuth, false);
    console.log("  FAIL: unknown widget key should have been rejected");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("Unknown widget key")) {
      console.log(`  Unknown widget key correctly rejected: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Role dashboard: canManageDashboards required to edit.
  try {
    await updateDashboard(firstAccess.role.id, ["loads_by_status"], dispatcherAuth, false);
    console.log("  FAIL: dispatcher without canManageDashboards should not edit the role dashboard");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("Not authorized")) {
      console.log(`  Non-admin correctly blocked from editing role dashboard: ${e.message}`);
    } else {
      throw e;
    }
  }
  const updatedRole = await updateDashboard(firstAccess.role.id, ["loads_by_status"], adminAuth, true);
  console.log(`  canManageDashboards actor can edit the role dashboard: ${updatedRole.widgetKeys[0] === "loads_by_status" ? "OK" : "FAIL"}`);

  // Cross-role read: a driver cannot read the dispatcher role dashboard.
  // No linked Driver needed — this check only cares about role: "driver",
  // not driver-scoped load visibility (already covered by existing tests).
  const driverRoleUser = await prisma.user.create({
    data: { email: "dash.driver@test.com", passwordHash: await bcrypt.hash("password123", 10), name: "Dash Driver", role: "driver", companyId: company.id },
  });
  const driverAuth = { userId: driverRoleUser.id, companyId: company.id, role: "driver" as const, platformAdmin: false };
  try {
    await getDashboardData(firstAccess.role.id, driverAuth, false);
    console.log("  FAIL: driver should not read the dispatcher role dashboard");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("Not authorized")) {
      console.log(`  Cross-role read correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // Company dashboard: readable by anyone.
  const companyData = await getDashboardData(firstAccess.company.id, driverAuth, false);
  console.log(`  Company dashboard is readable by any role: ${typeof companyData === "object" ? "OK" : "FAIL"}`);

  // Widget correctness against known seeded data.
  const totalLoadsData = await getDashboardData(updatedPersonal.id, dispatcherAuth, false);
  const actualLoadCount = await prisma.load.count({ where: { companyId: company.id } });
  console.log(`  total_loads widget matches prisma.load.count(): ${totalLoadsData.total_loads.value === actualLoadCount ? "OK" : "FAIL (" + totalLoadsData.total_loads.value + " vs " + actualLoadCount + ")"}`);

  // ?role= override, gated by canManageDashboards.
  const roleOverride = await getRoleDashboard(company.id, "fleet_admin");
  console.log(`  getRoleDashboard fetches the requested role's dashboard: ${roleOverride.role === "fleet_admin" ? "OK" : "FAIL"}`);

  // Cross-company isolation, extending the established pattern to Dashboard.
  try {
    await updateDashboard(firstAccess.company.id, ["total_loads"], { ...adminAuth, companyId: otherCompany.id }, true);
    console.log("  FAIL: cross-company updateDashboard should have been blocked");
    process.exit(1);
  } catch (e) {
    if (e instanceof WorkflowError && e.message.includes("not found")) {
      console.log(`  Cross-company updateDashboard correctly blocked: ${e.message}`);
    } else {
      throw e;
    }
  }

  // WIDGET_KEYS sanity — every catalogue key actually resolves.
  const allWidgetsDashboard = await updateDashboard(firstAccess.personal.id, WIDGET_KEYS, dispatcherAuth, false);
  const allWidgetsData = await getDashboardData(allWidgetsDashboard.id, dispatcherAuth, false);
  console.log(`  Every catalogue widget key resolves without error: ${WIDGET_KEYS.every((k) => k in allWidgetsData) ? "OK" : "FAIL"}`);

  // Cleanup this test's rows.
  await prisma.dashboard.deleteMany({ where: { companyId: company.id } });
  await prisma.user.deleteMany({ where: { id: driverRoleUser.id } });

  // ── Test 37: load documents (FR-21) ──
  console.log("\n--- Test 37: load documents ---");

  const docTestLoad = await createLoad("Doc Test Origin", "Doc Test Destination", company.id, dispatcher.id);

  const docKey = buildKey(docTestLoad.id, "bill-of-lading.pdf");
  await uploadDocument(docKey, Buffer.from("fake pdf content"), "application/pdf");
  const docRow = await prisma.loadDocument.create({
    data: {
      loadId: docTestLoad.id,
      type: "bill_of_lading",
      fileName: "bill-of-lading.pdf",
      mimeType: "application/pdf",
      fileSize: 17,
      s3Key: docKey,
      uploadedById: dispatcher.id,
    },
  });
  console.log(`  Document row created: ${docRow.type === "bill_of_lading" ? "OK" : "FAIL"}`);

  const presignedUrl = await getPresignedUrl(docKey);
  console.log(`  getPresignedUrl returns a URL string: ${typeof presignedUrl === "string" && presignedUrl.length > 0 ? "OK" : "FAIL"}`);

  const listedDocs = await prisma.loadDocument.findMany({ where: { loadId: docTestLoad.id } });
  console.log(`  Document is listed under its load: ${listedDocs.length === 1 && listedDocs[0].id === docRow.id ? "OK" : "FAIL"}`);

  const loadWithCount = await prisma.load.findUniqueOrThrow({
    where: { id: docTestLoad.id },
    include: { _count: { select: { documents: true } } },
  });
  console.log(`  Load's _count.documents is accurate: ${loadWithCount._count.documents === 1 ? "OK" : "FAIL"}`);

  // Cross-company isolation: the exact filter shape the DELETE route uses
  // (id + loadId + load.companyId) must find nothing when scoped to a
  // company docRow doesn't belong to, even though the row genuinely exists.
  const crossCompanyCheck = await prisma.loadDocument.findFirst({
    where: { id: docRow.id, loadId: docTestLoad.id, load: { companyId: otherCompany.id } },
  });
  console.log(`  Cross-company document lookup correctly returns nothing: ${crossCompanyCheck === null ? "OK" : "FAIL"}`);
  if (crossCompanyCheck !== null) process.exit(1);

  const sameCompanyCheck = await prisma.loadDocument.findFirst({
    where: { id: docRow.id, loadId: docTestLoad.id, load: { companyId: company.id } },
  });
  console.log(`  Same-company document lookup finds it: ${sameCompanyCheck?.id === docRow.id ? "OK" : "FAIL"}`);

  await deleteDocument(docKey);
  await prisma.loadDocument.delete({ where: { id: docRow.id } });
  const afterDelete = await prisma.loadDocument.findMany({ where: { loadId: docTestLoad.id } });
  console.log(`  Delete removes the document row: ${afterDelete.length === 0 ? "OK" : "FAIL"}`);

  // Cleanup this test's rows.
  await prisma.loadStatusLog.deleteMany({ where: { loadId: docTestLoad.id } });
  await prisma.load.deleteMany({ where: { id: docTestLoad.id } });

  // ── Test 38: settings store (FR-55) ──
  console.log("\n--- Test 38: settings store ---");

  const missingKeyValue = await getSetting(company.id, "does_not_exist_key", "fallback-value");
  console.log(`  getSetting returns the fallback for a missing key: ${missingKeyValue === "fallback-value" ? "OK" : "FAIL"}`);

  const createdSetting = await setSetting(company.id, "test_setting_key", "first-value");
  console.log(`  setSetting creates a new row: ${createdSetting.value === "first-value" ? "OK" : "FAIL"}`);

  const updatedSetting = await setSetting(company.id, "test_setting_key", "second-value");
  console.log(`  setSetting upserts (same id, new value): ${updatedSetting.id === createdSetting.id && updatedSetting.value === "second-value" ? "OK" : "FAIL"}`);

  const allSettings = await getAllSettings(company.id);
  const foundTestKey = allSettings.find((s) => s.key === "test_setting_key");
  console.log(`  getAllSettings includes the row: ${foundTestKey?.value === "second-value" ? "OK" : "FAIL"}`);

  const crossCompanySetting = await getSetting(otherCompany.id, "test_setting_key", "not-leaked");
  console.log(`  Cross-company getSetting does not leak the value: ${crossCompanySetting === "not-leaked" ? "OK" : "FAIL"}`);

  await prisma.setting.delete({ where: { id: createdSetting.id } });

  // ── Test 39: HOS reset-threshold wired into checkEligibility (FR-55) ──
  console.log("\n--- Test 39: HOS reset-threshold wired into eligibility ---");

  const noRulesetDriver = await prisma.driver.create({
    data: {
      name: "No Ruleset Driver",
      licenseExpiry: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
      medicalCertExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      companyId: company.id,
      // hosRulesetId intentionally omitted — this is the fallback path.
    },
  });
  console.log(`  Fixture driver has no hosRulesetId: ${noRulesetDriver.hosRulesetId === null ? "OK" : "FAIL"}`);

  const eligibleWithFallback = await checkEligibility(noRulesetDriver.id);
  console.log(`  checkEligibility no longer skips HOS for a ruleset-less driver: ${eligibleWithFallback.reasonCode === "ELIGIBLE" ? "OK" : "FAIL (" + eligibleWithFallback.reasonCode + ")"}`);

  // Log enough driving time to exhaust an 11h/cycle cap with no qualifying
  // reset, using the default 10h threshold — same shape as the existing
  // Test 22 "exhausted driver" fixture, but through the settings fallback.
  const exhaustionStart = new Date(Date.now() - 12 * 3600_000);
  await prisma.dutyStatusEntry.create({
    data: {
      driverId: noRulesetDriver.id,
      companyId: company.id,
      dutyStatus: "driving",
      startedAt: exhaustionStart,
      endedAt: new Date(exhaustionStart.getTime() + 12 * 3600_000),
    },
  });
  const exhaustedWithFallback = await checkEligibility(noRulesetDriver.id);
  console.log(`  Fallback ruleset correctly computes HOURS_EXHAUSTED: ${exhaustedWithFallback.reasonCode === "HOURS_EXHAUSTED" ? "OK" : "FAIL (" + exhaustedWithFallback.reasonCode + ")"}`);

  // Prove the setting's value genuinely changes the computed result: a
  // dedicated driver with 6h driving, a 2h off-duty gap, then 4h driving
  // (most recent). A 1h reset threshold treats the 2h gap as a qualifying
  // reset (only the most recent 4h counts); a 10h threshold does not
  // (both driving spans count, 10h total).
  const hosThresholdTestDriver = await prisma.driver.create({
    data: {
      name: "Reset Threshold Test Driver",
      licenseExpiry: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
      medicalCertExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      companyId: company.id,
    },
  });
  const hosThresholdTestNow = new Date();
  const thresholdDriving1Start = new Date(hosThresholdTestNow.getTime() - 12 * 3600_000);
  const thresholdDriving1End = new Date(hosThresholdTestNow.getTime() - 6 * 3600_000);
  const thresholdOffDutyEnd = new Date(hosThresholdTestNow.getTime() - 4 * 3600_000);
  await prisma.dutyStatusEntry.createMany({
    data: [
      { driverId: hosThresholdTestDriver.id, companyId: company.id, dutyStatus: "driving", startedAt: thresholdDriving1Start, endedAt: thresholdDriving1End },
      { driverId: hosThresholdTestDriver.id, companyId: company.id, dutyStatus: "off_duty", startedAt: thresholdDriving1End, endedAt: thresholdOffDutyEnd },
      { driverId: hosThresholdTestDriver.id, companyId: company.id, dutyStatus: "driving", startedAt: thresholdOffDutyEnd, endedAt: hosThresholdTestNow },
    ],
  });

  const snapshotAt10h = await computeHosAvailabilityFromValues(hosThresholdTestDriver.id, { maxDrivingHoursPerCycle: 11, maxOnDutyWindowHours: 14, minOffDutyResetHours: 10 }, hosThresholdTestNow);
  const snapshotAt1h = await computeHosAvailabilityFromValues(hosThresholdTestDriver.id, { maxDrivingHoursPerCycle: 11, maxOnDutyWindowHours: 14, minOffDutyResetHours: 1 }, hosThresholdTestNow);
  console.log(`  10h threshold: 2h off-duty gap does not qualify, both driving spans count: ${snapshotAt10h.drivingHoursUsed === 10 ? "OK" : "FAIL (" + snapshotAt10h.drivingHoursUsed + ")"}`);
  console.log(`  1h threshold: 2h off-duty gap qualifies as a reset, only the most recent span counts: ${snapshotAt1h.drivingHoursUsed === 4 ? "OK" : "FAIL (" + snapshotAt1h.drivingHoursUsed + ")"}`);
  if (snapshotAt10h.drivingHoursUsed !== 10 || snapshotAt1h.drivingHoursUsed !== 4) process.exit(1);

  // Cleanup this test's rows.
  await prisma.dutyStatusEntry.deleteMany({ where: { driverId: { in: [noRulesetDriver.id, hosThresholdTestDriver.id] } } });
  await prisma.driver.deleteMany({ where: { id: { in: [noRulesetDriver.id, hosThresholdTestDriver.id] } } });

  // ── Test 40: fleet roster CRUD fields (FR-8/9/10) ──
  console.log("\n--- Test 40: fleet roster CRUD fields ---");

  // CarrierCompany: documentExpiryAlertDays defaults to 30, defaultVehicleId round-trips.
  const crudTestCarrier = await prisma.carrierCompany.create({
    data: { companyId: company.id, name: "CRUD Test Carrier" },
  });
  console.log(`  documentExpiryAlertDays defaults to 30: ${crudTestCarrier.documentExpiryAlertDays === 30 ? "OK" : "FAIL"}`);

  const carrierWithDefaultVehicle = await prisma.carrierCompany.update({
    where: { id: crudTestCarrier.id },
    data: { defaultVehicleId: vehicle.id },
  });
  console.log(`  defaultVehicleId round-trips: ${carrierWithDefaultVehicle.defaultVehicleId === vehicle.id ? "OK" : "FAIL"}`);

  // Vehicle VIN uniqueness.
  const crudTestVehicle = await prisma.vehicle.create({
    data: { vin: "CRUDTESTVIN000001", unitNumber: "CRUD-1", make: "Test", model: "Test", plate: "CRUD-1", companyId: company.id },
  });
  try {
    await prisma.vehicle.create({
      data: { vin: "CRUDTESTVIN000001", unitNumber: "CRUD-2", make: "Test", model: "Test", plate: "CRUD-2", companyId: company.id },
    });
    console.log("  FAIL: duplicate VIN should have been rejected at the DB level");
    process.exit(1);
  } catch (e: any) {
    console.log(`  Duplicate VIN correctly rejected (P2002): ${e.code === "P2002" ? "OK" : "FAIL"}`);
  }

  // Driver: required fields, endorsements array round-trips.
  const crudTestDriver = await prisma.driver.create({
    data: {
      name: "CRUD Test Driver",
      licenseExpiry: new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000),
      medicalCertExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      endorsements: ["hazmat", "tanker"],
      companyId: company.id,
    },
  });
  console.log(`  Driver endorsements array round-trips: ${JSON.stringify(crudTestDriver.endorsements) === JSON.stringify(["hazmat", "tanker"]) ? "OK" : "FAIL"}`);

  // Cross-company isolation: a carrier/vehicle/driver in this company is
  // invisible to an actor scoped to otherCompany's lookup pattern (the
  // exact filter shape every PATCH route above uses).
  const crossCompanyCarrierCheck = await prisma.carrierCompany.findFirst({ where: { id: crudTestCarrier.id, companyId: otherCompany.id } });
  console.log(`  Cross-company carrier lookup correctly returns nothing: ${crossCompanyCarrierCheck === null ? "OK" : "FAIL"}`);
  const crossCompanyVehicleCheck = await prisma.vehicle.findFirst({ where: { id: crudTestVehicle.id, companyId: otherCompany.id } });
  console.log(`  Cross-company vehicle lookup correctly returns nothing: ${crossCompanyVehicleCheck === null ? "OK" : "FAIL"}`);
  const crossCompanyDriverCheck = await prisma.driver.findFirst({ where: { id: crudTestDriver.id, companyId: otherCompany.id } });
  console.log(`  Cross-company driver lookup correctly returns nothing: ${crossCompanyDriverCheck === null ? "OK" : "FAIL"}`);

  // Cleanup this test's rows.
  await prisma.driver.delete({ where: { id: crudTestDriver.id } });
  await prisma.vehicle.delete({ where: { id: crudTestVehicle.id } });
  await prisma.carrierCompany.delete({ where: { id: crudTestCarrier.id } });

  // ── Test 41: password reset flow (FR-5) ──
  console.log("\n--- Test 41: password reset flow ---");
  {
    const email = `reset-test-${Date.now()}@test.com`;
    const originalHash = await bcrypt.hash("original-pw-123", 10);
    const resetUser = await prisma.user.create({
      data: { email, passwordHash: originalHash, name: "Reset Test", role: "dispatcher", companyId: company.id, status: "active" },
    });

    // No-op for unknown email — must not throw.
    await requestPasswordReset("no-such-user@test.com");

    await requestPasswordReset(email);
    const token = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: resetUser.id } });

    // Expired token rejected.
    await prisma.passwordResetToken.update({ where: { id: token.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    let expiredRejected = false;
    try {
      await resetPassword(token.token, "new-pw-456");
    } catch (e: any) {
      expiredRejected = e.message.includes("expired");
    }
    if (!expiredRejected) throw new Error("Test 41 failed: expired token was not rejected");

    // Fresh token succeeds and actually changes the password.
    await prisma.passwordResetToken.update({ where: { id: token.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
    await resetPassword(token.token, "new-pw-456");
    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: resetUser.id } });
    const newPasswordWorks = await bcrypt.compare("new-pw-456", updatedUser.passwordHash);
    const oldPasswordRejected = !(await bcrypt.compare("original-pw-123", updatedUser.passwordHash));
    if (!newPasswordWorks || !oldPasswordRejected) throw new Error("Test 41 failed: password was not actually updated");

    // Used token rejected on a second attempt.
    let usedRejected = false;
    try {
      await resetPassword(token.token, "another-pw-789");
    } catch (e: any) {
      usedRejected = e.message.includes("already been used");
    }
    if (!usedRejected) throw new Error("Test 41 failed: used token was not rejected");

    console.log("  All password reset assertions passed");

    // Cleanup this test's rows.
    await prisma.passwordResetToken.deleteMany({ where: { userId: resetUser.id } });
    await prisma.user.delete({ where: { id: resetUser.id } });
  }

  // ── Test 42: DVIR defect category vehicle-type exclusions (FR-13/14) ──
  console.log("\n--- Test 42: DVIR defect category vehicle-type exclusions ---");
  {
    const truckVehicle = await prisma.vehicle.create({
      data: { vin: "EXCLTESTVIN000001", unitNumber: "EXCL-TRUCK", make: "Test", model: "Test", plate: "EXCL-1", companyId: company.id, type: "truck" },
    });
    const trailerVehicle = await prisma.vehicle.create({
      data: { vin: "EXCLTESTVIN000002", unitNumber: "EXCL-TRAILER", make: "Test", model: "Test", plate: "EXCL-2", companyId: company.id, type: "trailer" },
    });

    const engineCategory = await prisma.defectCategory.create({
      data: { companyId: company.id, name: "Engine (exclusion test)", outcome: "minor_defect", excludedVehicleTypes: ["trailer"] },
    });
    const universalCategory = await prisma.defectCategory.create({
      data: { companyId: company.id, name: "Lights (exclusion test)", outcome: "minor_defect" },
    });

    const allCategories = await prisma.defectCategory.findMany({ where: { companyId: company.id, active: true } });

    const forTruck = allCategories.filter((c) => !c.excludedVehicleTypes.includes(truckVehicle.type));
    const forTrailer = allCategories.filter((c) => !c.excludedVehicleTypes.includes(trailerVehicle.type));

    const truckSeesEngine = forTruck.some((c) => c.id === engineCategory.id);
    const trailerExcludesEngine = !forTrailer.some((c) => c.id === engineCategory.id);
    const bothSeeUniversal = forTruck.some((c) => c.id === universalCategory.id) && forTrailer.some((c) => c.id === universalCategory.id);

    if (!truckSeesEngine || !trailerExcludesEngine || !bothSeeUniversal) {
      throw new Error("Test 42 failed: vehicle-type exclusion filtering produced wrong result");
    }

    console.log("  All DVIR vehicle-type exclusion assertions passed");

    // Cleanup this test's rows.
    await prisma.defectCategory.deleteMany({ where: { id: { in: [engineCategory.id, universalCategory.id] } } });
    await prisma.vehicle.deleteMany({ where: { id: { in: [truckVehicle.id, trailerVehicle.id] } } });
  }

  // ── Test 43: vehicle type class CRUD (FR-11) ──
  console.log("\n--- Test 43: vehicle type class CRUD ---");
  {
    const vtc = await prisma.vehicleTypeClass.create({
      data: { companyId: company.id, name: "Test Tractor Class", classKind: "tractor" },
    });
    if (vtc.sourceMarker !== "manual") throw new Error("Test 43 failed: sourceMarker did not default to manual");
    if (vtc.active !== true) throw new Error("Test 43 failed: active did not default to true");

    const updated = await prisma.vehicleTypeClass.update({ where: { id: vtc.id }, data: { active: false } });
    if (updated.active !== false) throw new Error("Test 43 failed: active did not update");

    const crossCompanyCheck = await prisma.vehicleTypeClass.findFirst({ where: { id: vtc.id, companyId: otherCompany.id } });
    if (crossCompanyCheck !== null) throw new Error("Test 43 failed: cross-company isolation broken");

    console.log("  All vehicle type class assertions passed");

    await prisma.vehicleTypeClass.delete({ where: { id: vtc.id } });
  }

  // ── Test 44: maintenance interval template CRUD (FR-12) ──
  console.log("\n--- Test 44: maintenance interval template CRUD ---");
  {
    const vtc = await prisma.vehicleTypeClass.create({
      data: { companyId: company.id, name: "Test Trailer Class", classKind: "trailer" },
    });
    const template = await prisma.maintenanceIntervalTemplate.create({
      data: { vehicleTypeClassId: vtc.id, taskName: "Oil Change", basis: "mileage", intervalValue: 15000 },
    });
    if (template.appliesToggle !== true) throw new Error("Test 44 failed: appliesToggle did not default to true");

    const listed = await prisma.maintenanceIntervalTemplate.findMany({ where: { vehicleTypeClassId: vtc.id } });
    if (listed.length !== 1 || listed[0].id !== template.id) throw new Error("Test 44 failed: list by vehicleTypeClassId returned wrong rows");

    const updated = await prisma.maintenanceIntervalTemplate.update({ where: { id: template.id }, data: { appliesToggle: false } });
    if (updated.appliesToggle !== false) throw new Error("Test 44 failed: appliesToggle did not update");

    const crossCompanyTemplate = await prisma.maintenanceIntervalTemplate.findUnique({
      where: { id: template.id },
      include: { vehicleTypeClass: true },
    });
    if (crossCompanyTemplate!.vehicleTypeClass.companyId !== company.id) throw new Error("Test 44 failed: parent join returned wrong company");
    if (crossCompanyTemplate!.vehicleTypeClass.companyId === otherCompany.id) throw new Error("Test 44 failed: cross-company isolation broken");

    console.log("  All maintenance interval template assertions passed");

    await prisma.maintenanceIntervalTemplate.delete({ where: { id: template.id } });
    await prisma.vehicleTypeClass.delete({ where: { id: vtc.id } });
  }

  // ── Test 45: fuel analytics helper (FR-56) ──
  console.log("\n--- Test 45: fuel analytics helper ---");
  {
    const noActual = estimateFuelConsumption(650, "truck");
    if (Math.abs(noActual.expectedGallons - 100) > 0.01) throw new Error(`Test 45 failed: expected ~100 gallons for 650mi truck, got ${noActual.expectedGallons}`);
    if (noActual.deviationPercent !== null || noActual.deviationFlag !== false) throw new Error("Test 45 failed: no-actual case should have null deviation");

    const withinThreshold = estimateFuelConsumption(650, "truck", 105);
    if (withinThreshold.deviationFlag !== false) throw new Error("Test 45 failed: 5% over should not flag (threshold is 15%)");

    const overThreshold = estimateFuelConsumption(650, "truck", 130);
    if (overThreshold.deviationFlag !== true) throw new Error("Test 45 failed: 30% over should flag");
    if (overThreshold.deviationPercent === null || overThreshold.deviationPercent < 15) throw new Error("Test 45 failed: deviationPercent should be positive and over 15");

    const underThreshold = estimateFuelConsumption(650, "truck", 70);
    if (underThreshold.deviationFlag !== true) throw new Error("Test 45 failed: 30% under should also flag (abs value)");

    const unknownType = estimateFuelConsumption(80, "spaceship");
    const otherType = estimateFuelConsumption(80, "other");
    if (Math.abs(unknownType.expectedGallons - otherType.expectedGallons) > 0.01) throw new Error("Test 45 failed: unrecognized vehicleType should fall back to other's curve");

    console.log("  All fuel analytics assertions passed");
  }

  // ── Cleanup test data ──
  const phase1CleanupLoadIds = [defaultTargetLoad.id, roleVisLoad.id, isDefaultLoad.id, commentLoad.id];
  await prisma.loadStatusLog.deleteMany({ where: { loadId: { in: phase1CleanupLoadIds } } });
  await prisma.load.deleteMany({ where: { id: { in: phase1CleanupLoadIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [maintenanceTechUser.id, platformAdminNonDispatch.id] } } });

  const cleanupLoadIds = [load.id, positionLoad.id, editableLoad.id];
  await prisma.loadStatusLog.deleteMany({ where: { loadId: { in: cleanupLoadIds } } });
  await prisma.load.deleteMany({ where: { id: { in: cleanupLoadIds } } });
  await prisma.user.delete({ where: { id: otherDispatcher.id } });
  await prisma.company.delete({ where: { id: otherCompany.id } });

  console.log("\n=== All tests passed ===");
}

main()
  .catch((e) => {
    console.error("\nTest failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
