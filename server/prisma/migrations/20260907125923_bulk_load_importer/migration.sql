-- CreateEnum
CREATE TYPE "UploadMode" AS ENUM ('standard', 'legacy');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('pending', 'validated', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "UploadRowStatus" AS ENUM ('ok', 'error');

-- CreateEnum
CREATE TYPE "AliasKind" AS ENUM ('carrier', 'vehicle', 'driver');

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "mode" "UploadMode" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'pending',
    "file_name" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "created_load_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_rows" (
    "id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "raw_data" JSONB NOT NULL,
    "carrier_name" TEXT,
    "vehicle_unit_no" TEXT,
    "driver_name" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "matched_vehicle_id" TEXT,
    "matched_driver_id" TEXT,
    "hos_note" TEXT,
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "UploadRowStatus" NOT NULL DEFAULT 'error',

    CONSTRAINT "upload_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aliases" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" "AliasKind" NOT NULL,
    "alias_text" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "uploads_company_id_idx" ON "uploads"("company_id");

-- CreateIndex
CREATE INDEX "upload_rows_upload_id_idx" ON "upload_rows"("upload_id");

-- CreateIndex
CREATE INDEX "aliases_company_id_idx" ON "aliases"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "aliases_company_id_kind_alias_text_key" ON "aliases"("company_id", "kind", "alias_text");

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_rows" ADD CONSTRAINT "upload_rows_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_rows" ADD CONSTRAINT "upload_rows_matched_vehicle_id_fkey" FOREIGN KEY ("matched_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_rows" ADD CONSTRAINT "upload_rows_matched_driver_id_fkey" FOREIGN KEY ("matched_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aliases" ADD CONSTRAINT "aliases_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
