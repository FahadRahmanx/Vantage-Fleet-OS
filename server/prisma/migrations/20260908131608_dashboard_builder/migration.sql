-- CreateEnum
CREATE TYPE "DashboardScope" AS ENUM ('personal', 'role', 'company');

-- CreateTable
CREATE TABLE "dashboards" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "scope" "DashboardScope" NOT NULL,
    "owner_id" TEXT,
    "role" "UserRole",
    "widget_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboards_company_id_idx" ON "dashboards"("company_id");

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
