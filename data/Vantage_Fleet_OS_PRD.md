# Vantage Fleet OS — Product Requirements Document (PRD)

**Project:** Vantage Fleet OS — Maintenance, Dispatch & Compliance Platform
**Reference RFP:** RFP-VFO-2026-03, Vantage Freight Holdings Ltd. (issued 24 Aug 2026)
**Context:** Internship technical assessment — 3-day solo proof-of-concept (POC) plus a delivery plan for the full engagement
**Stack:** PostgreSQL, Express, React, Node (PERN)

---

## 1. Overview

Vantage operates a regional trucking and last-mile delivery fleet and wants to digitise its end-to-end operation: load intake → driver/vehicle assignment (with an hours-of-service eligibility check) → pre-trip inspection → dispatch → post-trip inspection → maintenance triage → compliance recordkeeping. A reference implementation already exists (Django, ~51 database tables, 38 view modules); the RFP asks bidders to either reproduce that stack or propose an equivalent that meets the same functional requirements (FR-1 through FR-57).

This is not a real commercial bid. It's an internship assessment that uses a real, dense RFP as source material, evaluated on:
1. A working POC
2. A 5–6 page project plan
3. A 5–10 min recorded walkthrough (Loom) of both

**The core judgment call this PRD documents:** the full build is a 24–40 week, multi-person engagement (per the RFP's own estimate, §7). Three days solo cannot attempt it. Rather than a shallow demo touching many screens, the POC goes deep on the single riskiest mechanism the RFP itself names — a configurable, data-driven workflow engine with an immutable audit trail — and documents everything else as a reasoned, phased plan instead of pretending it was built.

---

## 2. Goals & Non-Goals

### Goals
- Demonstrate understanding of the full RFP scope (all 57 functional requirements), not just the part being built.
- Build a genuinely correct implementation of the hardest mechanism in the system: statuses/transitions as configurable data, not hardcoded logic, with a server-enforced, atomic, immutable audit log.
- Justify every scoping decision (what's in, partial, or out) with engineering reasoning tied back to specific FRs — not just "ran out of time."
- Produce artifacts (project plan, architecture diagrams, FR coverage matrix, this PRD) that read like they came from someone who understands how real engagements get scoped and phased.

### Non-Goals (for the POC specifically)
- Full role coverage (RFP §4.1/FR-1 names 5 assignable roles — driver, dispatcher, maintenance_tech, compliance_officer, fleet_admin — plus a `platform_admin` super-user flag layered on top of any role, not a 6th role), mobile app, hours-of-service ledger math, telematics ingestion, dashboards, bulk import, partner API — all explicitly deferred (see §6).
- Visual/UI polish. Time budget goes to correctness of the engine underneath, not the screen in front of it.
- Production-readiness (CI/CD pipelines, full test coverage, security hardening) — noted as a full-engagement concern, not a 3-day one.

---

## 3. Technical Approach & Stack Justification

### 3.1 Why PostgreSQL instead of MongoDB (PERN, not MERN)

The RFP does not mandate a stack (§5.1): the reference implementation is Django 5.x, but bidders proposing an alternative are explicitly invited to, and the RFP's own worked example of an acceptable alternative is "Next.js + tRPC + Prisma" — i.e. a Postgres-and-Prisma data layer, the same one this POC uses. The domain is relational at its core, and three specific requirements make that concrete rather than a style preference:

- **Configurable workflow engine (FR-23/24):** statuses and transitions are rows with foreign-key relationships to each other. Validating "is this transition legal from this status" is a join, and Postgres enforces the edge exists via a foreign key — Mongo would need that check re-implemented and re-tested in application code on every write path.
- **Immutable audit trail (FR-35):** an `advance()` call must update the load's status and insert an audit row atomically — both happen or neither does. This is a single-document illusion in Mongo only if audit and status live in the same document, which they structurally don't (one load has many audit rows over its life). Postgres gives this as a transaction for free.
- **Company scoping enforced server-side (FR-2/FR-3):** scoping is a `WHERE` clause against a foreign key on every table. Relational integrity means a dangling `company_id` is a constraint violation caught immediately, not a runtime bug discovered in production.

None of this is impossible in Mongo — it's additional application code and discipline to get integrity guarantees Postgres provides structurally. Express, React, and Node stay the same as originally planned; only the data layer changes, so there's no framework-learning cost, only an ORM (Prisma) instead of an ODM.

### 3.2 Development approach for the POC
- **Prisma** as the ORM/migration tool — schema-as-code keeps the status/transition tables reviewable and gives typed queries.
- Business rules (eligibility, transition validation, audit writes) live in a **plain service layer**, not in route handlers or the ORM — so the same functions are unit-testable without spinning up HTTP.
- A **seed script** creates 4–5 statuses and their transitions as data, not code, so the demo can prove "add a status without a deploy" live.
- No UI framework beyond React + plain CSS — time budget goes to engine correctness, not visual polish.

### 3.3 Stack for the parts not built in the POC (full-engagement reference)

The RFP's own response checklist (§12) asks for a stack justification covering hosting, background jobs, mobile, and integrations — not just the data layer. None of the following is built in the 3-day POC; it's recorded here so the full technical response isn't silently missing, and to give the phased plan in §8.1 a concrete stack to build against.

| RFP requirement (§5.1/§5.4) | Reference (Django) stack | Proposed PERN-equivalent | Why |
|---|---|---|---|
| Background jobs / cache | Celery + Redis | BullMQ + Redis | Redis-backed like Celery, but a native Node library — no cross-language bridge between the API process and worker process. |
| Mobile driver app (mandatory, FR-27, native/hybrid, no browser fallback) | React Native | React Native | RFP requires native/hybrid; React Native is stack-neutral (talks to any REST API) and is the RFP's own reference choice — no reason to deviate. |
| Object storage | AWS S3 via django-storages | AWS S3 via `@aws-sdk/client-s3` | Same provider, Node SDK instead of Python. |
| Notifications | SMTP relay + SMS gateway | SMTP relay (Nodemailer) + SMS gateway (e.g. Twilio) | Same integration shape; RFP doesn't mandate a vendor. |
| Auth | django-allauth | Custom JWT (as in the POC) + refresh-token rotation for mobile | The POC's JWT approach extends directly; device-bound refresh tokens for FR-5's mobile session requirement are additive, not a rewrite. |
| Container / CI | Docker + Kubernetes; GitHub Actions | Unchanged | Neither is stack-specific — no reason to deviate from the RFP's own reference. |

The one deliberate non-default: Celery/Redis becomes BullMQ/Redis rather than keeping Celery, since running a Python worker process alongside a Node API doubles the runtime surface for no benefit once the web layer itself is Node.

---

## 4. Scope of Work

### 4.1 What the full engagement covers (reference only)
The RFP defines FR-1 through FR-57 across roles/access, auth, catalogue data, dispatch, the workflow engine, HOS compliance, bulk import, telematics, dashboards, and a partner API, plus a mandatory offline-capable mobile driver app. Summarised here to show the scope was read in full — it is **not** the basis for the 3-day estimate.

### 4.2 What the POC actually builds
A vertical slice through the two hardest, most load-bearing mechanisms, end to end and server-enforced:
- Role- and company-scoped auth (2 of the RFP's 5 assignable roles — dispatcher, fleet_admin; `platform_admin` is a super-user flag layered on any role, not a distinct 6th role) — scoping enforced in the query layer (FR-2/FR-3), not hidden in the UI.
- Load entity with create/list/detail (FR-17–FR-19, reduced field set).
- Driver/vehicle assignment with a single-ruleset eligibility check — license and medical-certificate expiry only, no HOS ledger (FR-22, simplified).
- A genuinely configurable workflow engine: statuses and transitions are database rows, editable without a deploy, driving advance/revert (FR-23, FR-24, FR-30, FR-31).
- An immutable, append-only audit log of every transition, written in the same DB transaction as the status change (FR-35).

Explicitly out of the 3-day POC: the mobile app, HOS ledger reconciliation, telematics ingestion, dashboards, bulk import, the partner API, and the help centre — listed openly rather than silently dropped (see §6 and §8).

---

## 5. System Architecture

The POC architecture is layered: client → API → domain services → data. The mobile-app box is shown greyed out because it is explicitly not built.

![POC Architecture](diagrams/architecture.png)

*Figure 1 — POC architecture: layered client / API / domain services / data, PERN stack.*

**Why this shape:** role and company-scope checks sit in Express middleware so they run on *every* route automatically, not per-handler (directly satisfying FR-2's "enforced at the controller/query layer, not merely hidden in the UI"). The three domain services — Workflow Engine, Eligibility Service, Audit Logger — are plain Node modules with no framework dependency, so they can be unit-tested in isolation and are the pieces most likely to be reused unchanged if the full engagement later adds roles or screens.

---

## 6. Data Model

The data model below covers exactly the tables the POC touches. Statuses and transitions are modelled as their own tables with a self-referencing relationship (a transition points from one status row to another) — this is the schema-level expression of "configurable without code changes."

![POC Data Model](diagrams/er_workflow.png)

*Figure 2 — POC data model and the `advance()` transaction sequence.*

**The `advance(load, targetStatus)` sequence, as a single DB transaction:**
1. Re-check role + company scope
2. Validate the transition exists in the transitions table
3. Run the eligibility service if the target status requires it
4. Update `loads.current_status_id`
5. Insert one row into `load_status_logs` (never updated or deleted afterward)

If any step fails, the whole transaction rolls back — there is no state where a load's status changed but no audit row exists, or vice versa.

---

## 7. FR Scope Coverage Matrix

Point-by-point mapping of every functional requirement (FR-1–FR-57) to POC coverage, in the format the RFP's own Response Checklist (§12) asks bidders to provide.

**Status legend:** **In** = built for real · **Partial** = shape preserved, depth cut · **Out** = not touched in the POC

| RFP Section | FRs | Status | Reasoning |
|---|---|---|---|
| 4.1 Roles & Access Control | FR-1–FR-4 | **Partial** | FR-2 (server-side permission checks) and FR-3 (company scoping) are **in** — load-bearing for everything else. FR-1 (RFP names 5 assignable roles — driver, dispatcher, maintenance_tech, compliance_officer, fleet_admin — plus a `platform_admin` super-user flag on top of any role) is **partial**: 2 of the 5 roles are built (dispatcher, fleet_admin), since more roles means more UI screens repeating the same server-enforced scoping pattern, not a harder problem — it doesn't change whether FR-2/FR-3 actually work. FR-4 (impersonation) is **out** — an admin convenience layered on the role model, unrelated to workflow/audit correctness. |
| 4.2 Auth, Users & Invitations | FR-5–FR-7 | **Partial** | FR-5 (login) is in, simplified — no mobile device-bound tokens, since there's no mobile app. FR-6/FR-7 (invitation emails, user admin screens) are **out** — accounts seeded directly into the database. Plumbing, not judgment. |
| 4.3 Companies, Vehicles, Driver Records | FR-8–FR-10 | **Partial** | Records exist with a reduced field set (just what eligibility checking needs). Full CRUD admin screens are **out**. |
| 4.4 Vehicle & Equipment Catalogue | FR-11–FR-16 | **Out** | All reference/lookup data — config the workflow engine reads, not behavior. A handful of hardcoded seed rows does the same job in the demo as a full admin UI. |
| 4.5 Dispatch & Load Management | FR-17–FR-21 | **Partial** | FR-17 (load entity) and FR-20 (locked once advanced) are **in** — FR-20 ties directly to workflow correctness. FR-18/19 (filters, grouping, document galleries) are partial-to-out. FR-21 (file uploads) is fully **out** — an object-storage integration orthogonal to the workflow risk. |
| 4.6 Driver Assignment & Eligibility | FR-22 | **Partial** | Assignment form exists; eligibility check cut down to license/medical-cert expiry only. Shape kept, depth cut on purpose (see FR-26). |
| **4.7 Workflow Engine** | FR-23–FR-25 | **In** (mostly) | The centerpiece. FR-23/24 (statuses/transitions as DB rows) fully built. FR-25 (drag-to-reorder UX, auto-generated flowchart) is **partial** — data is editable; the polished admin screen isn't built. |
| 4.8 Eligibility & Outcome Routing | FR-26–FR-28 | **Partial** | FR-26 narrowed to a single rule instead of full ruleset resolution + HOS ledger (a separate hard problem, see FR-40). FR-27 (mobile/server sync) fully **out** — no mobile app exists. FR-28 (outcome routing) is **partial** — basic routing demoed without full DVIR severity calculation. |
| 4.9 Record & Advance Modal | FR-29 | **Partial** | A single advance/revert control exists and is reused, not the full shared-modal-across-4-screens version. |
| **4.10 Advance/Revert & Audit** | FR-30, FR-31, FR-35 | **In** | The second centerpiece — proves the system keeps an honest, atomic record of every state change. |
| 4.10 Bulk Operations | FR-32–FR-34 | **Out** | Same underlying `advance()` logic, just looped with a selection UI. No new risk once `advance()` is proven correct. |
| 4.11 Workbenches | FR-36, FR-37 | **Out** | Kanban views built on top of the workflow engine — a filtered load list. Adds screens, not risk. |
| 4.12 Routes | FR-38 | **Out** | An additional entity with its own rules; nothing else in the POC depends on it. |
| 4.13 Maintenance Triage | FR-39 | **Out** | A separate domain the POC's chosen slice never touches. |
| 4.14 Hours-of-Service Ledger | FR-40 | **Out (explicitly)** | Named by the RFP itself as one of the three hardest things in the system — a distinct, self-contained calculation problem, not an extension of the workflow engine. Doing it half-right would look worse than not attempting it. |
| 4.15 Compliance Workbench | FR-41–FR-43 | **Out** | Depends on the HOS ledger and Routes, neither of which exist in the POC. |
| 4.16 Bulk Upload | FR-44–FR-46 | **Out** | A multi-step spreadsheet importer — data-plumbing, unrelated to the workflow/audit risk area. |
| 4.17 Telematics | FR-47, FR-48 | **Out** | Requires an external sandbox integration Vantage would provide. |
| 4.18 Dashboards | FR-49 | **Out** | Analytics layer on top of data that barely exists yet in the POC. |
| 4.19 Reports | FR-50 | **Out** | Marked *Optional* in the RFP itself. |
| 4.20 Help Guide & Articles | FR-51 | **Out** | A content/CMS feature, no bearing on technical risk areas. |
| 4.21 Partner API | FR-52 | **Out** | A public-facing integration surface with its own security requirements — real, separate work. |
| 4.22 Navigation Configuration | FR-53 | **Out** | Matters only once many roles and screens exist — neither does yet in the POC. |
| 4.23 Notification Templates | FR-54 | **Out** | Requires an email-sending integration and template editor. |
| 4.24 Settings | FR-55 | **Out** | The one setting the POC needs (eligibility threshold) is hardcoded rather than built as a generic admin screen. |
| 4.25 Fuel Analytics | FR-56 | **Out** | Marked *Optional/Future* in the RFP itself. |
| 4.26 Reset / Maintenance Tooling | FR-57 | **Out** | Marked *Temporary* in the RFP itself, explicitly "low-effort tooling, not a user feature." |

**The reasoning pattern behind every row:**
1. **In** — either the named risk area itself, or a hard requirement for that risk area to mean anything (server-side permission checks, company scoping, advance/revert).
2. **Partial** — the shape of a requirement is preserved but the depth is cut, specifically where the full depth is itself a separate hard problem (e.g. HOS math) that would dilute focus rather than add proof.
3. **Out** — a separate subsystem with its own integration surface (mobile, telematics, partner API, email), pure CRUD over static reference data, or a convenience layered on already-proven logic (bulk ops, workbenches, nav config).

**Summary counts:** In — 9 requirements · Partial — 12 requirements · Out — 36 requirements

---

## 8. Milestones

### 8.1 Full-engagement phasing (context, not this submission's timeline)
If this were the actual multi-month engagement, phasing the RFP's own suggested structure (§6.2) into an MVP-first sequence:

| Phase | Content | Exit criterion |
|---|---|---|
| 0 — Foundations | Auth, roles, company scoping, catalogue data | CI green; role/scope checks server-enforced and tested |
| 1 — Core dispatch (MVP, RFP §6.4) | Loads, configurable workflow engine, routes, Maintenance + Dispatch workbenches, single-ruleset compliance review | Deployed increment; dispatcher can run a load end-to-end |
| 2 — Compliance depth | Full HOS ledger, multi-ruleset eligibility, dual server/mobile sync design, compliance workbench lifecycle | HOS reconciliation tested against declared logs |
| 3 — Mobile & offline | Native/hybrid driver app, offline DVIR + HOS capture, conflict-safe sync | Field test in low-connectivity conditions |
| 4 — Scale features | Bulk/legacy import, telematics ingestion + partner API, dashboards, nav config, help centre | Partner API sandbox-tested; dashboards on real data |

### 8.2 The 3-day POC — actual schedule for this submission

| Day | Focus | Concrete output |
|---|---|---|
| Day 1 | Schema + auth. Prisma schema for users/companies/vehicles/drivers/loads/statuses/transitions/audit log. JWT auth, role middleware, company-scope middleware. Seed data. | Migrations run clean; a logged-in dispatcher only sees their own company's rows (verified by a test, not by eye). |
| Day 2 | Workflow engine + eligibility. `advance()`/`revert()` service functions, transition validation against the DB, eligibility check on assignment, audit log write inside the transaction. | Advancing a load through 3+ statuses works; reverting works; every transition produces exactly one audit row. |
| Day 3 | UI + hardening + recording. Minimal React screens (load list/detail, assignment form, status advance control), fix edge cases found while wiring UI to API, record the Loom. | Working demo: create load → assign → ineligible-driver block → advance → revert → audit trail visible. |

This is deliberately front-loaded on the data layer and business rules and back-loaded on UI — a config-driven engine that's wrong underneath isn't rescued by a good-looking screen in front of it.

---

## 9. Risks & Assumptions

- Three days solo means no code review and a thin test suite — the POC prioritises correctness of the transition/audit path (the part expensive to get wrong later) over breadth of screens.
- The RFP's company-scoping model has two tiers: the platform is multi-tenant across fleet operators (top-level `company_id`, what the POC builds and proves), and within a tenant, owner-operator carrier accounts are further scoped to only their own assigned loads/vehicles (FR-3, second tier). The POC proves the top-level mechanism only; the carrier-level sub-scoping is the same pattern applied one level deeper and is deferred, not silently dropped.
- The dual client/server eligibility requirement (FR-27) is a real, unsolved design question even in the reference system's own risk register (§11.3) — the POC does not attempt the mobile half of it; it demonstrates the server-side rule engine a mobile client would eventually call or mirror.
- Assumes seed/reference data (vehicle types, fault codes, initial statuses) is fabricated for the demo rather than supplied, since this is a capability POC, not a UAT environment.
- HOS ledger math (FR-40) is intentionally excluded — it's a distinct, self-contained calculation problem from the workflow engine, and conflating them in one 3-day slice would have proven neither well.

---

## 10. Reference Material Used

To validate the domain and the workflow-engine pattern before building:
- **Domain workflow (dispatch/DVIR/maintenance):** Fleetio (free trial — work-order kanban closely mirrors FR-36), Motive (DVIR → work order flow, FR-13/14/39), Samsara (driver-facing inspection flow, FR-27/§5.2).
- **Configurable workflow-engine pattern (the actual thing being built):** Jira's Workflow Editor (closest public analogue to FR-23/24/25 — statuses/transitions as data, a visual diagram of allowed edges, drag-to-reorder), Linear's workflow states (a cleaner, more minimal example), Zendesk's ticket status/business rules (outcome-driven routing, analogous to FR-28).

The Jira analogy was treated as the primary reference for the admin config pattern, since it's structurally the same problem (states + allowed edges + a visual diagram, editable without a deploy) independent of the trucking domain.

---

## 11. Deliverables Checklist

- [x] Working POC (role/company-scoped auth, load + assignment, configurable workflow engine, advance/revert, immutable audit log)
- [x] Project plan (this document consolidates it) — summary, scope of work, milestones, approach, architecture diagrams
- [x] FR-1–FR-57 coverage matrix with reasoning (§7)
- [ ] 5–10 min Loom walkthrough of project plan + POC
