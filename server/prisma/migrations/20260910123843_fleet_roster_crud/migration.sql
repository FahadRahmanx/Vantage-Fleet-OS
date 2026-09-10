-- AlterTable
ALTER TABLE "carrier_companies" ADD COLUMN     "default_vehicle_id" TEXT,
ADD COLUMN     "document_expiry_alert_days" INTEGER DEFAULT 30;

-- AddForeignKey
ALTER TABLE "carrier_companies" ADD CONSTRAINT "carrier_companies_default_vehicle_id_fkey" FOREIGN KEY ("default_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
