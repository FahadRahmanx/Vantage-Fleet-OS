import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createLoad, assignDriver, advance } from "../src/services/workflow";
import { submitInspection } from "../src/services/inspections";
import { createRoute } from "../src/services/routes";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // ─── Company ──────────────────────────────────────────
  const company = await prisma.company.create({
    data: { name: "Vantage Freight Holdings", telematicsApiKey: "telematics-dev-key-vantage-freight" },
  });
  console.log(`  Company: ${company.name} (${company.id})`);

  // ─── Carrier Company (FR-9/10 — owner-operator partner) ─
  const carrier = await prisma.carrierCompany.create({
    data: {
      companyId: company.id,
      name: "Northwind Owner-Operators",
      contactName: "Sam Carrier",
      contactEmail: "sam@northwind-oo.example",
    },
  });
  console.log(`  Carrier: ${carrier.name} (${carrier.id})`);

  // ─── Users ────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("password123", 10);

  const dispatcher = await prisma.user.create({
    data: {
      email: "dispatcher@test.com",
      passwordHash,
      name: "Jane Dispatcher",
      role: UserRole.dispatcher,
      companyId: company.id,
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: "admin@test.com",
      passwordHash,
      name: "Bob Admin",
      role: UserRole.fleet_admin,
      platformAdmin: true, // FR-1: a flag layered on any role, not a 7th enum value
      companyId: company.id,
    },
  });
  console.log(`  Users: ${dispatcher.email} (${dispatcher.role}), ${admin.email} (${admin.role}, platformAdmin)`);

  // ─── Drivers ──────────────────────────────────────────
  const now = new Date();

  const eligibleDriver = await prisma.driver.create({
    data: {
      name: "Alice Eligible",
      licenseExpiry: new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()),
      licenseClass: "Class A",
      medicalCertExpiry: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
      homeTerminal: "Melbourne",
      companyId: company.id,
    },
  });

  const expiredDriver = await prisma.driver.create({
    data: {
      name: "Charlie Expired",
      licenseExpiry: new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()),
      licenseClass: "Class A",
      medicalCertExpiry: new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
      homeTerminal: "Sydney",
      carrierCompanyId: carrier.id,
      companyId: company.id,
    },
  });
  console.log(`  Drivers: ${eligibleDriver.name} (eligible), ${expiredDriver.name} (expired medical cert, carrier: ${carrier.name})`);

  // ─── Driver-role logins (FR-1) ─────────────────────────
  // Each linked 1:1 to a Driver profile via User.driverId, so the driver
  // role has something concrete to scope "own assignments" against.
  const driverUser1 = await prisma.user.create({
    data: {
      email: "driver@test.com",
      passwordHash,
      name: eligibleDriver.name,
      role: UserRole.driver,
      driverId: eligibleDriver.id,
      companyId: company.id,
    },
  });

  const driverUser2 = await prisma.user.create({
    data: {
      email: "driver2@test.com",
      passwordHash,
      name: expiredDriver.name,
      role: UserRole.driver,
      driverId: expiredDriver.id,
      companyId: company.id,
    },
  });
  console.log(`  Driver logins: ${driverUser1.email} (-> ${eligibleDriver.name}), ${driverUser2.email} (-> ${expiredDriver.name})`);

  // ─── HOS Ruleset (Phase 2, single simplified ruleset per company) ───
  const hosRuleset = await prisma.hosRuleset.create({
    data: { companyId: company.id },
  });
  await prisma.driver.updateMany({ data: { hosRulesetId: hosRuleset.id } });
  console.log(`  HOS ruleset: ${hosRuleset.name} (11h drive / 14h window / 10h reset)`);

  // ─── Settings (FR-55) ───────────────────────────────────
  await prisma.setting.create({
    data: { companyId: company.id, key: "hos_reset_threshold_hours", value: "10" },
  });
  console.log(`  Setting: hos_reset_threshold_hours = 10`);

  const defaultNotificationTemplate = JSON.stringify({
    subject: "New Load Assignment — {{routeRef}}",
    title: "You've been assigned a load",
    intro: "Hi {{driverName}}, you've been assigned to route {{routeRef}}.",
    closing: "Dispatch time: {{dispatchTime}}. Vehicle: {{vehicleUnitNumber}}. Stops: {{stopCount}}.",
    signature: "— Vantage Fleet Dispatch",
  });
  await prisma.setting.create({
    data: { companyId: company.id, key: "driver_assignment_notification_template", value: defaultNotificationTemplate },
  });
  console.log(`  Setting: driver_assignment_notification_template (default)`);

  // ─── Help Articles (FR-51) ───────────────────────────────
  await prisma.helpArticle.create({
    data: {
      companyId: company.id,
      title: "Getting Started with Vantage Fleet OS",
      summary: "A quick tour of the dashboard, navigation, and where to find things.",
      keywords: ["getting started", "overview", "navigation"],
      content: "<h2>Welcome</h2><p>This guide covers the basics of navigating Vantage Fleet OS.</p>",
      published: true,
      order: 0,
      visibleToCarriers: true,
    },
  });
  await prisma.helpArticle.create({
    data: {
      companyId: company.id,
      title: "Submitting a DVIR",
      summary: "How to complete a pre-trip or post-trip vehicle inspection.",
      keywords: ["dvir", "inspection", "pre-trip", "post-trip"],
      content: "<h2>Submitting a DVIR</h2><p>Select the load, choose pre-trip or post-trip, and record any defects found.</p>",
      published: true,
      order: 1,
      visibleToCarriers: true,
    },
  });
  await prisma.helpArticle.create({
    data: {
      companyId: company.id,
      title: "Understanding Load Statuses",
      summary: "What each status in the dispatch workflow means and who can act on it.",
      keywords: ["load status", "workflow", "dispatch"],
      content: "<h2>Load Statuses</h2><p>Loads move through a configurable workflow — see the Workflow Configuration screen for your company's exact statuses.</p>",
      published: true,
      order: 2,
      visibleToCarriers: false,
    },
  });
  console.log("  Help articles: 3 seeded");

  // ─── Worked-example driver (Phase 2 test fixture) ───
  // 08:00-12:00 driving, 12:00-13:00 off_duty, 13:00-17:00 driving, "today".
  // The 1h off-duty span never reaches the 10h reset threshold, so nothing
  // clears: drivingHoursUsed=8h, availableDriveHours=11-8=3h.
  const workedExampleDriver = await prisma.driver.create({
    data: {
      name: "Wendy WorkedExample",
      licenseExpiry: new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()),
      medicalCertExpiry: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
      hosRulesetId: hosRuleset.id,
      companyId: company.id,
    },
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await prisma.dutyStatusEntry.createMany({
    data: [
      { driverId: workedExampleDriver.id, companyId: company.id, dutyStatus: "driving", startedAt: new Date(today.getTime() + 8 * 3600_000), endedAt: new Date(today.getTime() + 12 * 3600_000) },
      { driverId: workedExampleDriver.id, companyId: company.id, dutyStatus: "off_duty", startedAt: new Date(today.getTime() + 12 * 3600_000), endedAt: new Date(today.getTime() + 13 * 3600_000) },
      { driverId: workedExampleDriver.id, companyId: company.id, dutyStatus: "driving", startedAt: new Date(today.getTime() + 13 * 3600_000), endedAt: new Date(today.getTime() + 17 * 3600_000) },
    ],
  });
  console.log(`  Worked-example driver: ${workedExampleDriver.name} (8h driving logged today, no qualifying reset)`);

  // ─── Hours-exhausted driver (Phase 2 test fixture, FR-22's "Ineligible — Hours Exhausted") ───
  const exhaustedDriver = await prisma.driver.create({
    data: {
      name: "Hank HoursExhausted",
      licenseExpiry: new Date(now.getFullYear() + 2, now.getMonth(), now.getDate()),
      medicalCertExpiry: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
      hosRulesetId: hosRuleset.id,
      companyId: company.id,
    },
  });
  await prisma.dutyStatusEntry.create({
    data: { driverId: exhaustedDriver.id, companyId: company.id, dutyStatus: "driving", startedAt: new Date(today.getTime() + 6 * 3600_000), endedAt: new Date(today.getTime() + 17 * 3600_000) },
  });
  console.log(`  Hours-exhausted driver: ${exhaustedDriver.name} (11h driving logged today, 0h available)`);

  // ─── Other-role logins (Phase 0 role expansion coverage) ───
  const maintenanceUser = await prisma.user.create({
    data: {
      email: "maintenance@test.com",
      passwordHash,
      name: "Mo Maintenance",
      role: UserRole.maintenance_tech,
      companyId: company.id,
    },
  });

  const complianceUser = await prisma.user.create({
    data: {
      email: "compliance@test.com",
      passwordHash,
      name: "Cara Compliance",
      role: UserRole.compliance_officer,
      companyId: company.id,
    },
  });
  console.log(`  Other role logins: ${maintenanceUser.email} (${maintenanceUser.role}), ${complianceUser.email} (${complianceUser.role})`);

  // ─── Vehicles ─────────────────────────────────────────
  const truck1 = await prisma.vehicle.create({
    data: {
      vin: "1FUJA6CV12LM12345",
      unitNumber: "1001",
      make: "Freightliner",
      model: "Cascadia",
      year: 2022,
      plate: "VAN-1001",
      companyId: company.id,
    },
  });

  const truck2 = await prisma.vehicle.create({
    data: {
      vin: "1XPBD49X1ND123456",
      unitNumber: "2002",
      make: "Peterbilt",
      model: "579",
      year: 2021,
      plate: "VAN-2002",
      carrierCompanyId: carrier.id,
      companyId: company.id,
    },
  });
  console.log(`  Vehicles: ${truck1.unitNumber} (${truck1.make} ${truck1.model}), ${truck2.unitNumber} (${truck2.make} ${truck2.model}, carrier: ${carrier.name})`);

  // ─── Defect Categories (Phase 4, feeds outcome computation) ───
  const defectPass = await prisma.defectCategory.create({
    data: { companyId: company.id, name: "Minor Cosmetic", outcome: "pass" },
  });
  const defectMinor = await prisma.defectCategory.create({
    data: { companyId: company.id, name: "Worn Wiper Blade", outcome: "minor_defect" },
  });
  const defectOOS = await prisma.defectCategory.create({
    data: { companyId: company.id, name: "Brake Failure", outcome: "out_of_service", requiresTechnicianNote: true },
  });
  console.log(`  Defect categories: ${defectPass.name} (pass), ${defectMinor.name} (minor_defect), ${defectOOS.name} (out_of_service)`);

  // ─── Dispatch Statuses (data-driven, per FR-23/24) ───
  // position ranks each status (FR-23); advance() requires target.position
  // >= current, revert() requires target.position < current (FR-31). Created
  // and Delivered anchor the ends; Out of Service sits alongside Assigned
  // since it's a same-rank exception branch, not further progress.
  const statusCreated = await prisma.dispatchStatus.create({
    data: { name: "Created", code: "created", position: 0, isDefault: true, color: "#666666", roleVisibility: ["dispatcher", "fleet_admin"], companyId: company.id },
  });
  const statusAssigned = await prisma.dispatchStatus.create({
    data: { name: "Assigned", code: "assigned", position: 1, isDispatchStatus: true, requiresEligibilityCheck: true, color: "#856404", roleVisibility: ["dispatcher", "fleet_admin"], companyId: company.id },
  });
  const statusInProgress = await prisma.dispatchStatus.create({
    data: { name: "In Transit", code: "in_transit", position: 2, isInTransitStatus: true, color: "#004085", roleVisibility: ["dispatcher", "fleet_admin"], companyId: company.id },
  });
  const statusDelivered = await prisma.dispatchStatus.create({
    // FR-23/41: delivered loads' routes queue for compliance review.
    data: { name: "Delivered", code: "delivered", position: 3, isComplianceReviewQueue: true, color: "#00884b", roleVisibility: ["dispatcher", "fleet_admin", "compliance_officer"], companyId: company.id },
  });
  const statusOOS = await prisma.dispatchStatus.create({
    // FR-36: the Maintenance Workbench's "flagged" column, resolved by
    // isFlaggedStatus, never by code/name.
    data: { name: "Out of Service", code: "out_of_service", position: 1, isFlaggedStatus: true, color: "#ba1a1a", roleVisibility: ["dispatcher", "fleet_admin", "maintenance_tech"], companyId: company.id },
  });
  const statusInRepair = await prisma.dispatchStatus.create({
    // FR-36: the Maintenance Workbench's "in repair" column.
    data: { name: "In Repair", code: "in_repair", position: 1, isInRepairStatus: true, color: "#a15c07", roleVisibility: ["maintenance_tech", "fleet_admin"], companyId: company.id },
  });

  console.log(`  Statuses: ${[statusCreated, statusAssigned, statusInProgress, statusDelivered, statusOOS, statusInRepair].map((s) => s.code).join(", ")}`);

  // ─── Transitions (the graph edges) ────────────────────
  const transitionData = [
    // Forward path. The assigned -> in_transit edge carries the "pass"
    // outcome trigger as well as being the default target, so a clean DVIR
    // routes forward automatically (FR-28).
    { fromStatusId: statusCreated.id, toStatusId: statusAssigned.id, isDefaultTarget: true },
    { fromStatusId: statusAssigned.id, toStatusId: statusInProgress.id, isDefaultTarget: true, outcomeTrigger: "pass" as const },
    { fromStatusId: statusInProgress.id, toStatusId: statusDelivered.id, isDefaultTarget: true },
    // Out-of-service branch. An inspection that finds an out-of-service
    // defect routes here automatically rather than by manual selection.
    { fromStatusId: statusAssigned.id, toStatusId: statusOOS.id, outcomeTrigger: "out_of_service" as const },
    { fromStatusId: statusOOS.id, toStatusId: statusCreated.id },
    // FR-42: compliance review can route a delivered load's vehicle back to
    // maintenance if a later (e.g. post-trip) inspection surfaces a defect.
    { fromStatusId: statusDelivered.id, toStatusId: statusOOS.id },
    // Maintenance workbench: claim for repair (advance, same rank), repair
    // complete back to Created (revert, backward rank) — thin wrappers
    // around the existing generalized advance()/revert(), per FR-36.
    { fromStatusId: statusOOS.id, toStatusId: statusInRepair.id, isDefaultTarget: true },
    { fromStatusId: statusInRepair.id, toStatusId: statusCreated.id, isDefaultTarget: true },
    // Revert paths (for testing revert + operational flexibility)
    { fromStatusId: statusInProgress.id, toStatusId: statusAssigned.id },
    { fromStatusId: statusDelivered.id, toStatusId: statusInProgress.id },
  ];

  for (const t of transitionData) {
    await prisma.dispatchTransition.create({
      data: { ...t, companyId: company.id },
    });
  }
  console.log(`  Transitions: ${transitionData.length} edges created`);

  // ─── Demo Loads ───────────────────────────────────────
  // One load per sidebar screen's non-empty state, built through the real
  // service functions (not raw prisma.create) so each one also produces a
  // genuine audit trail, DVIR record, or route the way a real user's
  // actions would — Audit History and the Dispatch/Maintenance/Compliance
  // workbenches all have something to show on first login.

  // Loads tab + Dispatch Board "Assigned" column
  const loadAssigned = await createLoad("Seattle DC", "Portland Hub", company.id, dispatcher.id);
  await assignDriver(loadAssigned.id, eligibleDriver.id, truck1.id, dispatcher.id);
  await advance(loadAssigned.id, statusAssigned.id, dispatcher.id);

  // Dispatch Board "In Transit" column — pass DVIR auto-routes it forward
  const loadInTransit = await createLoad("Denver Yard", "Phoenix Terminal", company.id, dispatcher.id);
  await assignDriver(loadInTransit.id, eligibleDriver.id, truck2.id, dispatcher.id);
  await advance(loadInTransit.id, statusAssigned.id, dispatcher.id);
  await submitInspection({
    loadId: loadInTransit.id, vehicleId: truck2.id, driverId: eligibleDriver.id,
    type: "pre_trip", defectEntries: [], actorId: dispatcher.id,
  });

  // Maintenance Workbench "Flagged" column
  const loadFlagged = await createLoad("Chicago Yard", "Detroit Terminal", company.id, dispatcher.id);
  await assignDriver(loadFlagged.id, eligibleDriver.id, truck1.id, dispatcher.id);
  await advance(loadFlagged.id, statusAssigned.id, dispatcher.id);
  await advance(loadFlagged.id, statusOOS.id, dispatcher.id);

  // Maintenance Workbench "In Repair" column
  const loadInRepair = await createLoad("Dallas Yard", "Houston Terminal", company.id, dispatcher.id);
  await assignDriver(loadInRepair.id, eligibleDriver.id, truck2.id, dispatcher.id);
  await advance(loadInRepair.id, statusAssigned.id, dispatcher.id);
  await advance(loadInRepair.id, statusOOS.id, dispatcher.id);
  await advance(loadInRepair.id, undefined, maintenanceUser.id); // claim -> in_repair (default target)

  // Compliance Workbench queue — delivered + grouped into a route, not yet reviewed
  const loadForCompliance = await createLoad("Atlanta DC", "Miami Hub", company.id, dispatcher.id);
  await assignDriver(loadForCompliance.id, eligibleDriver.id, truck1.id, dispatcher.id);
  await advance(loadForCompliance.id, statusAssigned.id, dispatcher.id);
  await submitInspection({
    loadId: loadForCompliance.id, vehicleId: truck1.id, driverId: eligibleDriver.id,
    type: "pre_trip", defectEntries: [], actorId: dispatcher.id,
  });
  await advance(loadForCompliance.id, statusDelivered.id, dispatcher.id);
  await createRoute(company.id, dispatcher.id, [loadForCompliance.id]);

  console.log(`  Demo loads: ${[loadAssigned, loadInTransit, loadFlagged, loadInRepair, loadForCompliance].map((l) => l.reference).join(", ")}`);

  // ─── Summary ──────────────────────────────────────────
  console.log("\nSeed complete.");
  console.log("  Login credentials:");
  console.log("    dispatcher@test.com / password123 (role: dispatcher)");
  console.log("    admin@test.com      / password123 (role: fleet_admin, platformAdmin)");
  console.log("    driver@test.com     / password123 (role: driver -> Alice Eligible)");
  console.log("    driver2@test.com    / password123 (role: driver -> Charlie Expired)");
  console.log("    maintenance@test.com / password123 (role: maintenance_tech)");
  console.log("    compliance@test.com  / password123 (role: compliance_officer)");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
