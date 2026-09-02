-- CreateTable
CREATE TABLE "compliance_records" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT NOT NULL,
    "pass_count" INTEGER NOT NULL,
    "minor_defect_count" INTEGER NOT NULL,
    "out_of_service_count" INTEGER NOT NULL,
    "total_hos_hours" DOUBLE PRECISION NOT NULL,
    "finalized_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compliance_records_route_id_key" ON "compliance_records"("route_id");

-- CreateIndex
CREATE INDEX "compliance_records_company_id_idx" ON "compliance_records"("company_id");

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_records" ADD CONSTRAINT "compliance_records_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

