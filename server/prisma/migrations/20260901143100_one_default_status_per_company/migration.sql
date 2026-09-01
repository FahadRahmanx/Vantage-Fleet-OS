-- Enforce at most one default (starting) status per company (FR-20/FR-23).
-- Mirrors dispatch_transitions_one_default_target — without this, marking a
-- second status isDefault:true via the Workflow Configuration screen would
-- silently leave createLoad()'s `findFirst({ where: { isDefault: true } })`
-- to pick whichever one Postgres returns first, which is not deterministic.
CREATE UNIQUE INDEX dispatch_statuses_one_default
  ON dispatch_statuses(company_id) WHERE is_default = true;
