-- AlterTable
ALTER TABLE "dispatch_statuses" ADD COLUMN     "load_list_columns" TEXT[] DEFAULT ARRAY[]::TEXT[];
