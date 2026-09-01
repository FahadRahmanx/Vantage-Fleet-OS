# Loom Walkthrough Script (target: 7–9 minutes)

Record after Task 4's UI checklist passes end-to-end. Screen-share the browser at
http://localhost:5173 plus the PRD open in an editor for the first segment.

## 1. Framing (60–90s)
"This is a 3-day solo internship assessment against a real, dense RFP — 57 functional
requirements, a reference Django implementation with 51 tables. Three days can't
attempt that; I went deep on the two riskiest mechanisms the RFP itself names — a
configurable workflow engine and an atomic audit trail — instead of a shallow demo
touching many screens."

## 2. Project plan & scope reasoning (90–120s)
Show `Vantage_Fleet_OS_PRD.md` §7 (FR coverage table) and §5–6 (diagrams).
"9 requirements fully built, 12 partial, 36 explicitly out — each with a one-line
engineering reason, not just 'ran out of time.' The pattern: In = the risk area itself
or a hard prerequisite for it; Partial = shape kept, depth cut where the full depth is
itself a separate hard problem, like HOS math; Out = a separate subsystem (mobile,
telematics, partner API) or pure CRUD over static data. Full per-requirement reasoning
is in the companion FR_Scope_Coverage.md if anyone wants to check a specific FR."

## 3. Live demo — golden path (3–4 min)
1. Log in as dispatcher@test.com.
2. Create a load (origin/destination).
3. Try assigning "Charlie Expired" — show the blocked-eligibility error live.
4. Assign "Alice Eligible" instead — succeeds.
5. Advance Created -> Assigned -> In Transit, narrating: "each advance re-validates
   the transition against the database, not a hardcoded switch statement."
6. Revert In Transit -> Assigned, point at the audit trail growing by one row per
   transition, each with actor + timestamp.
7. Open the Prisma schema or the seed script briefly: "statuses and transitions are
   rows — adding a new status is a database insert, not a deploy."

## 4. What's deliberately not built (60–90s)
"Mobile app, HOS ledger, telematics, dashboards, bulk import, partner API — all
named directly in the PRD as out of scope for the 3-day slice, with the reasoning
for each. The full engagement phasing is in PRD §8.1 if useful."

## 5. Close (20–30s)
"That's the POC and the plan — code and docs both in the repo, README has the run
instructions."
