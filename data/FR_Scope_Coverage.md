# Vantage Fleet OS — FR Scope Coverage Matrix (POC vs. Full Build)

**Project:** Vantage Fleet OS — Maintenance, Dispatch & Compliance Platform
**Reference:** RFP-VFO-2026-03, Vantage Freight Holdings Ltd. (issued 24 Aug 2026)
**Purpose of this document:** point-by-point mapping of every functional requirement (FR-1–FR-57) in the RFP to what the 3-day solo POC covers, with the reasoning behind each call. This is the level of detail the RFP's own Response Checklist (§12) asks bidders to provide ("point-by-point response to the functional requirements ... indicating compliance for each").

**Status legend**
- **In** — built for real, not a stub
- **Partial** — the shape of the requirement is preserved; the depth is deliberately cut
- **Out** — not touched in the POC

---

## Coverage Table

| RFP Section | FRs | Status | Reasoning |
|---|---|---|---|
| 4.1 Roles & Access Control | FR-1–FR-4 | **Partial** | FR-2 (server-side permission checks) and FR-3 (company scoping) are **in** — load-bearing for everything else. FR-1 (RFP names 5 assignable roles — driver, dispatcher, maintenance_tech, compliance_officer, fleet_admin — plus a `platform_admin` super-user flag layered on top of any role, not a 6th role) is **partial**: 2 of the 5 roles are built (dispatcher, fleet_admin), since more roles means more UI screens repeating the same server-enforced scoping pattern, not a harder problem — it doesn't change whether the scoping mechanism works, just how many times it's repeated. FR-4 (impersonation) is **out** — an admin convenience feature layered on the role model, unrelated to whether the core system is correct. |
| 4.2 Auth, Users & Invitations | FR-5–FR-7 | **Partial** | FR-5 (login) is in, simplified — no mobile device-bound tokens, since there's no mobile app. FR-6/FR-7 (invitation emails, user admin screens) are **out** — accounts are seeded directly into the database. This is plumbing; it proves nothing about engineering judgment, it just costs hours. |
| 4.3 Companies, Vehicles, Driver Records | FR-8–FR-10 | **Partial** | Records exist with a reduced field set (just what eligibility checking needs: license expiry, medical cert expiry). Full CRUD admin screens for managing these records are **out** — same reasoning as above. |
| 4.4 Vehicle & Equipment Catalogue | FR-11–FR-16 | **Out** | All reference/lookup data (vehicle types, fault codes, defect categories, legacy mappings). None of it is *behavior* — it's config the workflow engine reads, so a handful of hardcoded seed rows does the same job in the demo as a full admin UI, at a fraction of the cost. |
| 4.5 Dispatch & Load Management | FR-17–FR-21 | **Partial** | FR-17 (the load entity) and FR-20 (a load is locked once advanced) are **in** — FR-20 ties directly into the workflow engine's correctness. FR-18/19 (filters, grouping, document galleries) are partial-to-out — a basic list/detail view exists, but filtering/search/document-upload polish is skipped. FR-21 (file uploads) is fully **out** — an object-storage integration, orthogonal to the workflow risk. |
| 4.6 Driver Assignment & Eligibility | FR-22 | **Partial** | The assignment form exists, but the eligibility check is deliberately cut down to "is the license/medical cert expired" — no hours-of-service math, no debounced vehicle search. The *shape* of the requirement is kept; the *depth* is cut on purpose (see FR-26). |
| **4.7 Workflow Engine** | FR-23–FR-25 | **In** (mostly) | The centerpiece. FR-23/24 (statuses and transitions are database rows, not hardcoded) are fully built — the actual thing being proven. FR-25 (drag-to-reorder admin UX, auto-generated flowchart diagram) is **partial** — the data is editable, but the polished admin screen for editing it isn't built; diagram-generation is a UI-effort sink, not proof of the underlying mechanism. |
| 4.8 Eligibility & Outcome Routing | FR-26–FR-28 | **Partial** | FR-26 (eligibility determination) is narrowed to a single simple rule instead of full priority-ordered ruleset resolution plus the hours-of-service ledger — because the HOS ledger (FR-40) is a self-contained, genuinely hard calculation problem on its own; bolting a half-built version onto the workflow engine risks breaking both rather than proving either. FR-27 (mobile/server eligibility sync) is fully **out** — there's no mobile app to sync with. FR-28 (outcome-based routing) is **partial** — basic outcome-triggered routing is demoed without the full DVIR defect-severity calculation behind it. |
| 4.9 Record & Advance Modal | FR-29 | **Partial** | A single advance/revert control exists and is reused, but not the full "shared modal across 4 screens with a fast-path" version — an engineering nicety once the underlying advance logic is correct. |
| **4.10 Advance/Revert & Audit** | FR-30, FR-31, FR-35 | **In** | The second centerpiece. FR-30 (advance), FR-31 (revert), and FR-35 (immutable audit log) are where "does the system keep an honest record of what happened" gets proven. |
| 4.10 Bulk Operations | FR-32–FR-34 | **Out** | Bulk advance/revert and whole-route advance are the *same* underlying `advance()` logic, just looped with a selection UI on top. Once `advance()` is proven correct for one load, looping it isn't new risk — it's UI time with no new learning. |
| 4.11 Workbenches | FR-36, FR-37 | **Out** | Kanban-style views (Maintenance, Dispatch) built on top of the workflow engine — a filtered, grouped version of the load list. Skipped because they add screens, not risk. |
| 4.12 Routes | FR-38 | **Out** | An additional entity (grouping loads, batch-advancing a whole route) with its own rules; nothing else in the POC depends on it. |
| 4.13 Maintenance Triage | FR-39 | **Out** | A separate domain (fault codes, technician sign-off) the POC's chosen slice never touches. |
| 4.14 Hours-of-Service Ledger | FR-40 | **Out (explicitly)** | Named by the RFP itself as one of the three hardest things in the system. A distinct, self-contained cumulative-time calculation problem — different in kind from the workflow engine, not an extension of it. Doing it half-right would look worse than not attempting it. |
| 4.15 Compliance Workbench | FR-41–FR-43 | **Out** | Depends on both the HOS ledger and Routes, neither of which exist in the POC. |
| 4.16 Bulk Upload | FR-44–FR-46 | **Out** | A multi-step spreadsheet importer — data-plumbing, unrelated to the workflow/audit risk area. |
| 4.17 Telematics | FR-47, FR-48 | **Out** | Requires an external sandbox integration Vantage would provide — not something a solo POC can stand up in 3 days regardless of stack. |
| 4.18 Dashboards | FR-49 | **Out** | A reporting/analytics layer on top of data that barely exists yet in the POC. |
| 4.19 Reports | FR-50 | **Out** | Marked *Optional* in the RFP itself — lowest-priority item in the document. |
| 4.20 Help Guide & Articles | FR-51 | **Out** | A content/CMS feature, no bearing on the technical risk areas. |
| 4.21 Partner API | FR-52 | **Out** | A public-facing integration surface with its own security requirements (token auth, rate limits) — a real, separate piece of work, not a small add-on. |
| 4.22 Navigation Configuration | FR-53 | **Out** | A meta-feature (configuring the sidebar per role) that only matters once many roles and many screens exist — neither does yet in the POC. |
| 4.23 Notification Templates | FR-54 | **Out** | Requires an email-sending integration and template editor — plumbing. |
| 4.24 Settings | FR-55 | **Out** | A general key-value config store; the one setting the POC needs (the eligibility threshold) is hardcoded rather than built as a generic admin screen. |
| 4.25 Fuel Analytics | FR-56 | **Out** | Marked *Optional/Future* in the RFP itself. |
| 4.26 Reset / Maintenance Tooling | FR-57 | **Out** | Marked *Temporary* in the RFP itself, and explicitly described as "low-effort tooling, not a user feature" — the RFP tells bidders not to spend real effort here. |

---

## The Reasoning Pattern

1. **In** — either the actual named risk area (workflow engine, audit trail) or a hard *requirement* for that risk area to mean anything at all (server-side permission checks, company scoping, advance/revert).
2. **Partial** — the *shape* of a requirement is preserved (an eligibility check exists, a load can be assigned) but the *depth* is cut, specifically where the full depth is itself a separate hard problem (e.g. HOS math) that would dilute focus rather than add proof.
3. **Out** — anything that is (a) a separate subsystem with its own integration surface (mobile app, telematics, partner API, email), (b) pure CRUD/admin screens over static reference data, or (c) a convenience layered on top of already-proven logic (bulk operations, workbenches, navigation config) — none of which teach an evaluator anything new about whether the hard part of the system works.

---

## Summary Counts

- **In:** FR-2, FR-3, FR-17, FR-20, FR-23, FR-24, FR-30, FR-31, FR-35 (9 requirements, fully built)
- **Partial:** FR-1, FR-5, FR-8, FR-9, FR-10, FR-18, FR-19, FR-22, FR-25, FR-26, FR-28, FR-29 (12 requirements, shape kept / depth cut)
- **Out:** all remaining FRs (36 requirements) — deferred to the full engagement, phased per the project plan's §5.1 sequencing
