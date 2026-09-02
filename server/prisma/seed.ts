import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

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

  // ─── Dispatch Statuses (data-driven, per FR-23/24) ───
  // position ranks each status (FR-23); advance() requires target.position
  // >= current, revert() requires target.position < current (FR-31). Created
  // and Delivered anchor the ends; Out of Service sits alongside Assigned
  // since it's a same-rank exception branch, not further progress.
  const statusCreated = await prisma.dispatchStatus.create({
    data: { name: "Created", code: "created", position: 0, isDefault: true, roleVisibility: ["dispatcher", "fleet_admin"], companyId: company.id },
  });
  const statusAssigned = await prisma.dispatchStatus.create({
    data: { name: "Assigned", code: "assigned", position: 1, isDispatchStatus: true, requiresEligibilityCheck: true, roleVisibility: ["dispatcher", "fleet_admin"], companyId: company.id },
  });
  const statusInProgress = await prisma.dispatchStatus.create({
    data: { name: "In Transit", code: "in_transit", position: 2, isInTransitStatus: true, roleVisibility: ["dispatcher", "fleet_admin"], companyId: company.id },
  });
  const statusDelivered = await prisma.dispatchStatus.create({
    data: { name: "Delivered", code: "delivered", position: 3, roleVisibility: ["dispatcher", "fleet_admin"], companyId: company.id },
  });
  const statusOOS = await prisma.dispatchStatus.create({
    data: { name: "Out of Service", code: "out_of_service", position: 1, roleVisibility: ["dispatcher", "fleet_admin"], companyId: company.id },
  });

  console.log(`  Statuses: ${[statusCreated, statusAssigned, statusInProgress, statusDelivered, statusOOS].map((s) => s.code).join(", ")}`);

  // ─── Transitions (the graph edges) ────────────────────
  const transitionData = [
    // Forward path
    { fromStatusId: statusCreated.id, toStatusId: statusAssigned.id, isDefaultTarget: true },
    { fromStatusId: statusAssigned.id, toStatusId: statusInProgress.id, isDefaultTarget: true },
    { fromStatusId: statusInProgress.id, toStatusId: statusDelivered.id, isDefaultTarget: true },
    // Out-of-service branch
    { fromStatusId: statusAssigned.id, toStatusId: statusOOS.id },
    { fromStatusId: statusOOS.id, toStatusId: statusCreated.id },
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
