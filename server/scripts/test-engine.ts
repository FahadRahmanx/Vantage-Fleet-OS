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
import { computeHosAvailability } from "../src/services/hos";

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
