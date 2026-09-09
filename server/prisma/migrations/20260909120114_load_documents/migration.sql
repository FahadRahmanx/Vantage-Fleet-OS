-- CreateEnum
CREATE TYPE "LoadDocumentType" AS ENUM ('bill_of_lading', 'pod', 'other');

-- CreateTable
CREATE TABLE "load_documents" (
    "id" TEXT NOT NULL,
    "load_id" TEXT NOT NULL,
    "type" "LoadDocumentType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "s3_key" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "load_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "load_documents_s3_key_key" ON "load_documents"("s3_key");

-- CreateIndex
CREATE INDEX "load_documents_load_id_idx" ON "load_documents"("load_id");

-- AddForeignKey
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_load_id_fkey" FOREIGN KEY ("load_id") REFERENCES "loads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_documents" ADD CONSTRAINT "load_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
