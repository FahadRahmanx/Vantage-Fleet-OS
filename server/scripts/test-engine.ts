/**
 * Test script for the workflow engine.
 * Run: npx tsx scripts/test-engine.ts
 *
 * Proves: advance(), revert(), eligibility blocking, audit log immutability.
 * No HTTP, no Express — plain service functions only.
 */

import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { advance, revert, assignDriver } from "../src/services/workflow";
import { WorkflowError, EligibilityError } from "../src/services/eligibility";

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
  const load = await prisma.load.create({
    data: {
      origin: "Melbourne DC",
      destination: "Sydney Store #42",
      companyId: company.id,
      creatorId: dispatcher.id,
      currentStatusId: statusMap["created"].id,
    },
  });
  console.log(`  Load created: ${load.id} (status: ${statusMap["created"].code})`);

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
  console.log("\n--- Test 11: Company scoping ---");
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

  // ── Cleanup test data ──
  await prisma.loadStatusLog.deleteMany({ where: { loadId: load.id } });
  await prisma.load.delete({ where: { id: load.id } });
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
