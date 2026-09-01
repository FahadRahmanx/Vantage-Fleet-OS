-- AlterTable
ALTER TABLE "dispatch_statuses" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "load_status_logs" ADD COLUMN     "reverted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "loads" ADD COLUMN     "reference" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "loads_reference_key" ON "loads"("reference");
