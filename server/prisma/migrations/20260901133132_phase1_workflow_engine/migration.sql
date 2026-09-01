-- CreateEnum
CREATE TYPE "InspectionOutcome" AS ENUM ('pass', 'minor_defect', 'out_of_service');

-- AlterTable
ALTER TABLE "dispatch_statuses" ADD COLUMN     "color" TEXT,
ADD COLUMN     "is_compliance_review_queue" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_dispatch_status" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_flagged_status" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_in_repair_status" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_in_transit_status" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_out_of_service_default" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_out_of_service_eligible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "required_fields" JSONB,
ADD COLUMN     "requires_eligibility_check" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "role_visibility" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "dispatch_transitions" ADD COLUMN     "is_default_target" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outcome_trigger" "InspectionOutcome";

-- AlterTable
ALTER TABLE "load_status_logs" ADD COLUMN     "batch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "captured_data" JSONB,
ADD COLUMN     "comment" TEXT,
ADD COLUMN     "stop_count" INTEGER;

-- Enforce at most one default-target transition per from-status (FR-24).
CREATE UNIQUE INDEX dispatch_transitions_one_default_target
  ON dispatch_transitions(from_status_id) WHERE is_default_target = true;

-- Enforce at most one transition per (from-status, outcome) pair, so
-- outcome-based auto-routing (a later phase) can never be ambiguous.
CREATE UNIQUE INDEX dispatch_transitions_one_per_outcome
  ON dispatch_transitions(from_status_id, outcome_trigger) WHERE outcome_trigger IS NOT NULL;
