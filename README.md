# Vantage Fleet OS — POC

Internship technical assessment: a 3-day solo POC of the configurable workflow-engine
and immutable audit-log mechanisms from RFP-VFO-2026-03. Full context, scope
reasoning, and the FR-1–FR-57 coverage matrix are in `data/Vantage_Fleet_OS_PRD.md`.

## Stack

PostgreSQL + Prisma, Express, React (Vite), Node 24, TypeScript.

## Running it

1. `npm install` (installs root, `client/`, and `server/` workspaces)
2. Configure `server/.env` — see `server/.env` for the required keys
   (`DATABASE_URL`, `JWT_SECRET`, `PORT`). Not committed; ask the repo owner for values.
3. `npm run db:migrate --workspace=server` (applies the Prisma schema)
4. `npm run db:seed --workspace=server` (creates a company, 2 users, 2 drivers — one
   eligible, one with an expired medical cert — 2 vehicles, and the 5-status workflow graph)
5. `npm run dev` (starts the API on :3001 and the client on :5173, concurrently)
6. Open http://localhost:5173, log in as `dispatcher@test.com` / `password123`

## Verifying correctness without the UI

- `npm run test:engine --workspace=server` — proves the workflow engine and audit log
  at the service layer (no HTTP).
- `npm run test:http --workspace=server` — proves the same golden path through the
  actual Express routes, including auth/role/company-scope middleware (requires the
  dev server running first).

## What's built vs. deferred

See `data/Vantage_Fleet_OS_PRD.md` §4 and §7, or `data/FR_Scope_Coverage.md` for the
full point-by-point reasoning. Short version: role/company-scoped auth, the
load/driver/vehicle entities, a data-driven status/transition workflow engine, and an
atomic, append-only audit log are real. The mobile app, HOS ledger, telematics,
dashboards, bulk import, and partner API are explicitly out of scope for the 3-day slice.
