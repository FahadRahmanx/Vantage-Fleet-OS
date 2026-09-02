-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "telematics_api_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "companies_telematics_api_key_key" ON "companies"("telematics_api_key");

