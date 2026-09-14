-- CreateEnum
CREATE TYPE "VehicleClassKind" AS ENUM ('tractor', 'straight_truck', 'trailer', 'refrigerated_trailer');

-- CreateEnum
CREATE TYPE "VehicleTypeSource" AS ENUM ('manual', 'telematics_sync', 'import');

-- CreateEnum
CREATE TYPE "MaintenanceIntervalBasis" AS ENUM ('mileage', 'time', 'engine_hour');

-- CreateTable
CREATE TABLE "vehicle_type_classes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "class_kind" "VehicleClassKind" NOT NULL,
    "source_marker" "VehicleTypeSource" NOT NULL DEFAULT 'manual',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_type_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_interval_templates" (
    "id" TEXT NOT NULL,
    "vehicle_type_class_id" TEXT NOT NULL,
    "task_name" TEXT NOT NULL,
    "basis" "MaintenanceIntervalBasis" NOT NULL,
    "interval_value" INTEGER NOT NULL,
    "applies_toggle" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_interval_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_type_classes_company_id_idx" ON "vehicle_type_classes"("company_id");

-- CreateIndex
CREATE INDEX "maintenance_interval_templates_vehicle_type_class_id_idx" ON "maintenance_interval_templates"("vehicle_type_class_id");

-- AddForeignKey
ALTER TABLE "vehicle_type_classes" ADD CONSTRAINT "vehicle_type_classes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_interval_templates" ADD CONSTRAINT "maintenance_interval_templates_vehicle_type_class_id_fkey" FOREIGN KEY ("vehicle_type_class_id") REFERENCES "vehicle_type_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
