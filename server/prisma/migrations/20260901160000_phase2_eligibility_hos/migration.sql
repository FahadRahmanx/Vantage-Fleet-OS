-- CreateEnum
CREATE TYPE "DutyStatusType" AS ENUM ('driving', 'on_duty_not_driving', 'off_duty', 'sleeper_berth');

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "hos_ruleset_id" TEXT;

-- AlterTable
ALTER TABLE "loads" ADD COLUMN     "driver_assigned_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "hos_rulesets" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Federal Property-Carrying Default',
    "max_driving_hours_per_cycle" DOUBLE PRECISION NOT NULL DEFAULT 11,
    "max_on_duty_window_hours" DOUBLE PRECISION NOT NULL DEFAULT 14,
    "min_off_duty_reset_hours" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hos_rulesets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duty_status_entries" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "load_id" TEXT,
    "duty_status" "DutyStatusType" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "on_duty_override" BOOLEAN,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duty_status_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hos_rulesets_company_id_idx" ON "hos_rulesets"("company_id");

-- CreateIndex
CREATE INDEX "duty_status_entries_driver_id_started_at_idx" ON "duty_status_entries"("driver_id", "started_at");

-- CreateIndex
CREATE INDEX "duty_status_entries_company_id_idx" ON "duty_status_entries"("company_id");

-- AddForeignKey
ALTER TABLE "hos_rulesets" ADD CONSTRAINT "hos_rulesets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_hos_ruleset_id_fkey" FOREIGN KEY ("hos_ruleset_id") REFERENCES "hos_rulesets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duty_status_entries" ADD CONSTRAINT "duty_status_entries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duty_status_entries" ADD CONSTRAINT "duty_status_entries_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
