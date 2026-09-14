# Vantage Fleet OS

A dispatch, compliance, and fleet-maintenance platform built against
RFP-VFO-2026-03: role/company-scoped auth, a configurable dispatch
workflow engine with an immutable audit log, hours-of-service eligibility
and outcome routing, DVIR inspections, bulk/legacy data import, dashboards,
document storage, admin CRUD for the fleet roster and reference data, and
a set of smaller supporting tools (notification templates, fuel-analytics
helper, reports placeholder, dev-only maintenance tooling).

This started as a 3-day POC of the workflow-engine/audit-log core; the
scope has since grown well past that as most of the RFP's functional
requirements (FR-1 through FR-57) have been implemented. It is not
production-hardened — see "What's built vs. deferred" below for what's
still missing before a real go-live.

## Stack

PostgreSQL + Prisma, Express, React (Vite), Node 24, TypeScript.

## Running it

1. `npm install` (installs root, `client/`, and `server/` workspaces)
2. Configure `server/.env` — see `server/.env` for the required keys
   (`DATABASE_URL`, `JWT_SECRET`, `PORT`, plus optional `SMTP_*`/AWS S3 keys
   for real email/document-storage delivery — both degrade to safe
   in-process fallbacks when unset). Not committed; ask the repo owner for
   values.
3. `npm run db:migrate` (applies the Prisma schema)
4. `npm run db:seed` (creates a company, users across all 6 roles, drivers,
   vehicles, the default workflow graph, HOS ruleset, settings, and a
   default notification template)
5. `npm run dev` (starts the API on :3001 and the client on :5173, concurrently)
6. Open http://localhost:5173 — see `data/Demo_Logins.txt` for seeded
   credentials across roles (dispatcher, fleet_admin/platformAdmin, driver, etc.)

## Verifying correctness without the UI

- `npm run test:engine --workspace=server` — service-layer regression suite
  (workflow engine, audit log, eligibility/HOS, DVIR outcome routing,
  imports, auth, settings, fleet-roster CRUD, and more — no HTTP).
- `npm run test:http --workspace=server` — the same kind of coverage
  exercised through the actual Express routes, including auth/role/
  company-scope middleware (requires the dev server running first).

Both suites are living regression tests — new sections get appended as
features are added, and both must stay green before any change is
considered complete.

## What's built vs. deferred

Most of the RFP's FR-1–FR-57 are implemented: role-based auth with
company scoping, invitations, admin CRUD for users/carriers/vehicles/
drivers/defect-categories/vehicle-type-classes/maintenance-interval-
templates, the configurable dispatch workflow engine with an atomic
audit log, HOS eligibility and DVIR outcome routing, routes and the
compliance workbench, bulk and legacy spreadsheet import, a dashboard
builder, document storage, a settings store, password recovery and
remember-me, and a handful of smaller tools (notification templates,
a fuel-analytics helper, a reports placeholder, dev-only data-reset
tooling gated out of production).

Still partial or not started: platform-admin impersonation (FR-4), the
shared "Record & Advance" modal and bulk/whole-route advance (FR-29/32-34),
the maintenance triage workbench (FR-39), a real mobile driver app (FR-27
has no counterpart to stay in sync with), generated compliance summaries
(FR-43), the read-only telematics web view and CLI/Partner-API ingestion
(FR-47/48), the help centre (FR-51), the Partner API (FR-52), the per-role
navigation builder (FR-53), and deeper richness on the load list/detail,
assignment form, and workflow-management UX (FR-18/19, FR-22, FR-25).

`data/Vantage_Fleet_OS_PRD.md` and `data/FR_Scope_Coverage.md` describe the
original 3-day POC scope and are now out of date relative to this list —
treat this README section as the current source of truth.
