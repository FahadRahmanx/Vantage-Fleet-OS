-- CreateEnum
CREATE TYPE "DriverAdminStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('active', 'in_maintenance', 'out_of_service', 'retired');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'driver';
ALTER TYPE "UserRole" ADD VALUE 'maintenance_tech';
ALTER TYPE "UserRole" ADD VALUE 'compliance_officer';

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "admin_status" "DriverAdminStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "carrier_company_id" TEXT,
ADD COLUMN     "endorsements" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "home_terminal" TEXT,
ADD COLUMN     "license_class" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "driver_id" TEXT,
ADD COLUMN     "platform_admin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "carrier_company_id" TEXT,
ADD COLUMN     "data_source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "engine_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "fuel_type" TEXT,
ADD COLUMN     "home_terminal" TEXT,
ADD COLUMN     "insurance_expiry" TIMESTAMP(3),
ADD COLUMN     "last_telematics_update_at" TIMESTAMP(3),
ADD COLUMN     "odometer" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "registration_expiry" TIMESTAMP(3),
ADD COLUMN     "status" "VehicleStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "unit_number" TEXT NOT NULL,
ADD COLUMN     "vin" TEXT NOT NULL,
ADD COLUMN     "year" INTEGER;

-- CreateTable
CREATE TABLE "carrier_companies" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carrier_companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "carrier_companies_company_id_idx" ON "carrier_companies"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_driver_id_key" ON "users"("driver_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vin_key" ON "vehicles"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_company_id_unit_number_key" ON "vehicles"("company_id", "unit_number");

-- AddForeignKey
ALTER TABLE "carrier_companies" ADD CONSTRAINT "carrier_companies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_carrier_company_id_fkey" FOREIGN KEY ("carrier_company_id") REFERENCES "carrier_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_carrier_company_id_fkey" FOREIGN KEY ("carrier_company_id") REFERENCES "carrier_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
