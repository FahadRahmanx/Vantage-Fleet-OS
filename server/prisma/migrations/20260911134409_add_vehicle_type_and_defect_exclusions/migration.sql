-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('truck', 'trailer', 'van', 'other');

-- AlterTable
ALTER TABLE "defect_categories" ADD COLUMN     "excluded_vehicle_types" "VehicleType"[] DEFAULT ARRAY[]::"VehicleType"[];

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "type" "VehicleType" NOT NULL DEFAULT 'other';
