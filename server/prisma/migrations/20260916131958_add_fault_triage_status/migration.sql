-- CreateEnum
CREATE TYPE "FaultTriageStatus" AS ENUM ('not_triaged', 'in_repair', 'completed');

-- AlterTable
ALTER TABLE "dvir_inspection_defects" ADD COLUMN     "out_of_service_override" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "FaultTriageStatus" NOT NULL DEFAULT 'not_triaged';
