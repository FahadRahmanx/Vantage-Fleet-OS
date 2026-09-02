-- CreateEnum
CREATE TYPE "InspectionType" AS ENUM ('pre_trip', 'post_trip');

-- CreateTable
CREATE TABLE "defect_categories" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outcome" "InspectionOutcome" NOT NULL,
    "requires_technician_note" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "defect_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dvir_inspections" (
    "id" TEXT NOT NULL,
    "load_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "type" "InspectionType" NOT NULL,
    "odometer_reading" INTEGER,
    "overall_outcome" "InspectionOutcome",
    "override_outcome" "InspectionOutcome",
    "override_reason" TEXT,
    "submitted_by_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dvir_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dvir_inspection_defects" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "defect_category_id" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "dvir_inspection_defects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "defect_categories_company_id_idx" ON "defect_categories"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "defect_categories_company_id_name_key" ON "defect_categories"("company_id", "name");

-- CreateIndex
CREATE INDEX "dvir_inspections_load_id_idx" ON "dvir_inspections"("load_id");

-- CreateIndex
CREATE INDEX "dvir_inspections_company_id_idx" ON "dvir_inspections"("company_id");

-- AddForeignKey
ALTER TABLE "defect_categories" ADD CONSTRAINT "defect_categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dvir_inspections" ADD CONSTRAINT "dvir_inspections_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dvir_inspections" ADD CONSTRAINT "dvir_inspections_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dvir_inspections" ADD CONSTRAINT "dvir_inspections_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dvir_inspection_defects" ADD CONSTRAINT "dvir_inspection_defects_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "dvir_inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dvir_inspection_defects" ADD CONSTRAINT "dvir_inspection_defects_defect_category_id_fkey" FOREIGN KEY ("defect_category_id") REFERENCES "defect_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

