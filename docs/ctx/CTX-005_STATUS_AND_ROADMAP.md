# CTX-005 — Status & Roadmap

**Status:** Approved
**Version:** 2.1.0
**Owner:** Residoro Engineering
**Created:** 2026-07-20
**Last Updated:** 2026-08-09
**Supersedes:** This document merges the original CTX-005 (Current Status) and CTX-006
(Roadmap) into one. CTX-006 is marked Deprecated and points here.

---

# Purpose

A strategic, phase-level snapshot of where Residoro is and where it's headed. This document
answers "what phase are we in and what's next," at the granularity a person or AI orienting
themselves needs — it does **not** track individual shipped/unshipped features; that's the
Theos Registry's job (`theos-registry/registry/INDEX.md`, and each capability's own
tracer-bullets for exact shipped status).

**Why this document was split into two, then merged back into one:** the original CTX-005/006
pair went badly stale — CTX-005 still described "Upcoming: Database Specifications, Identity
Engine, Workspace Engine, Permission Engine" as of a 2026-07-27 birds-eye review, when Property
Engine (Phase 3) and Migration Platform (Phase 6) were both already complete, and an entire
business domain (Client Lifecycle) had shipped without ever being added to the roadmap at all.
Merging status and roadmap into one document and **refreshing it only at phase/milestone
boundaries, not per-tracer-bullet**, is the deliberate fix — the previous drift happened because
nothing forced a periodic re-check against reality.

---

# Current Phase: Mixed — Phases 0–1 substantially complete, Phases 3 and 6 complete, Phases 2 and 4 well underway (not "barely started"/"not started" anymore), Phase 5 partially built, Phase 7 not started

Unlike the original phase-by-phase framing (which implied strict sequential progress), actual
delivery jumped ahead unevenly — Property Engine (Phase 3) and Migration Platform (Phase 6)
are both fully built, and by 2026-08-09 both CRM (Phase 2) and Buyer Operations/Transactions
(Phase 4) had shipped substantial real functionality — this line was corrected during a
2026-08-09 birds-eye audit that found it still calling Phase 4 "not started, no code exists"
while `cap-buyer-leads-001` and `cap-transactions-001` were both `status: active` in the
Registry with real shipped work, a genuinely misleading claim (not just stale) for anyone
onboarding onto this doc. See the per-phase status below.

---

# Phase Status

## Phase 0 — Repository Foundation ✅ Complete

Documentation structure, engineering standards, initial ADRs.

## Phase 1 — Database Design, Identity, Workspace — ✅ Mostly Complete

Database design, Identity, and Workspace are built (DS-001/DD-001, ADR-001/002/003). Core
Entities is a moving target rather than a single milestone — see later phases for what actually
shipped. **Permissions remains not built** — the Permission Engine (fine-grained, per-domain,
per-action) is still a scoped-out future milestone.

## Phase 2 — CRM: Contacts, Companies, Buyers, Sellers — 🟡 Substantially Built

**Corrected 2026-08-09** (was "Barely Started" — stale since 2026-07-28, caught by a birds-eye
audit). Contacts (DS-005/DD-005) plus a Company concept (`contacts.is_company`, absorbed the
standalone `developers` table — `tb-crm-developer-consolidation-001`), a unified Contacts page
with full CRUD (`tb-crm-contacts-page-001`), and `properties.owner_id`'s FK to `contacts`
(`tb-crm-owner-fk-001`) all shipped 2026-07-28 under `cap-crm-001` (`status: active`). "Buyers"
as a distinct pipeline concept is really Phase 4's Buyer Operations (see below), not a separate
CRM entity. "Sellers" as a distinct CRM concept still doesn't exist — property owners are
`contacts` rows, not a dedicated Seller pipeline.

## Phase 3 — Property Engine, Verification, Media, Documents, Listings, Authority to Sell — ✅ Complete

Fully built: Properties, Projects/Developers/Unit Types, bulk unit generation, Media (photos),
Documents (title/tax), Verification workflow, Listings (full lifecycle), Authority to
Sell/Lease (exclusivity, term dates, per-workspace policy), cross-brokerage docket sharing. See
DD-002, DD-006, DD-007, DD-008; DS-002, DS-004, DS-007, DS-008.

## Phase 4 — Buyer Operations, Seller Operations, Matching, Viewings, Offers, Transactions — 🟡 Substantially Built

**Corrected 2026-08-09** (was "Not Started, no code exists" — badly stale since 2026-07-28,
caught by a birds-eye audit; this was the single most consequential correction in that audit,
since it's a flatly wrong claim, not just an outdated one). **Buyer Operations**
(`cap-buyer-leads-001`, `status: active`, shipped 2026-07-28 onward): Inquiries pre-qualification
pen, the real Leads pipeline (`buyer_requirements`), a scored matching engine against active
listings and cross-tenant shared dockets, a "Buyer Wanted" broadcast fallback, and match/activity
history logging — see DD-018. **Transactions** (`cap-transactions-001`, `status: active`, shipped
2026-08-04): Viewings, Offers, Contracts, and Closings all built (see DD-010 through DD-013).
**Seller Operations** as a distinct concept still doesn't exist — a property's `owner_id` is a
`contacts` row (Phase 2/3), not a dedicated seller pipeline with its own stages.

## Phase 5 — Automation, Workflow Engine, Notifications, Reporting, Dashboards — ⚠️ Partially Built

**Corrected 2026-08-09** (Notifications specifically outgrew "barely started" — caught by a
birds-eye audit). `cap-notifications-001` (`status: active`) now covers four automated checks
(contract expiry, training reminders, listing authority expiry, and — added 2026-08-08 — task
due-date reminders, see DD-017/TS-003) plus in-app task-driven notifications from
`cap-tasks-001`'s stage-change auto-generation. Still no general workflow/automation engine (each
check is its own narrow `pg_cron` → Edge Function job, not a configurable rules engine), and no
reporting or dashboards exist — `cap-analytics-001`'s Performance page (share-count "Hot"
tracking) is the only analytics surface, not general reporting.

## Phase 6 — Migration Platform, AI Mapping, Validation, Preview, Production Import — ✅ Complete

Fully built: CSV upload, field mapping, validation, preview, dedup/conflict resolution,
confirmed import, and time-boxed rollback. See DD-003, DD-004; DS-003, DS-009; TS-004. **Naming
note**: "AI Mapping" as originally phrased is misleading — the in-app mapping step is a
deterministic header-string matcher, not an LLM call; real AI-assisted mapping happens in an
external Claude session an operator runs outside the app. See CTX-003's AI Integration section.

## Phase 7 — Marketplace Integrations, Public API, Mobile, Advanced Analytics, Enterprise Features — ❌ Not Started

No code exists for any of this.

---

# Built Beyond the Original Roadmap: Client Lifecycle

**Not in any phase above** — the invite-only, operator-run, contract-based client onboarding
model (`cap-client-lifecycle-001`) shipped as 9 tracer bullets without the original roadmap ever
naming it. This is arguably as consequential as Phase 3/6 to Residoro's actual go-to-market — a
brokerage cannot self-serve onto the platform at all; every enrollment is operator-driven. See
DS-006, CTX-002's Client Lifecycle domain section (added in the same 2026-07-27 refresh this
document is part of).

---

# Repository / Process Status

Git repository, documentation structure, README, and git standards were completed in Phase 0
and remain in place. Documentation-first discipline held well for the data-model layer
(`docs/dd/`, `docs/ds/` — see DD-004 through DD-009's retroactive-but-complete 2026-07-27
coverage) but not for this CTX layer, which the same review corrected. No CI, no staging
environment, and no automated tests exist as of 2026-07-27 — see RFC-001 (Approved) for the
deliberate, decided plan on infrastructure readiness, and CTX-003's Testing Philosophy section
for the testing gap specifically.

---

# Long-Term Objectives

Unchanged from the original framing: Brokerage Operating System MVP, AI Migration Engine
(see the Phase 6 naming note above — reconsider whether "AI" is the right framing given current
implementation), Workflow Automation Engine, Analytics Platform, Public Release.

---

# Success Criteria

Residoro should enable brokerages to operate their complete business from a single trusted
platform.

---

# Related Documents

- CTX-002 — Product Architecture (per-domain Built/Future status, kept in sync with this phase status)
- CTX-003 — Engineering Context
- `theos-registry` — `registry/INDEX.md` and per-capability tracer-bullets for granular shipped status
- RFC-001, RFC-002, RFC-003, RFC-005 — infrastructure/architecture decisions affecting what's
  next (RFC-005 reconciles RFC-001's superseded hosting decision)
- CTX-006 — Roadmap (deprecated, merged into this document)

---

# Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-20 | Initial project snapshot (as CTX-005 "Current Status"). |
| 2.0.0 | 2026-07-27 | Merged with CTX-006 (Roadmap) into one strategic status+roadmap document, retitled "Status & Roadmap." Corrected against actual code state via a birds-eye technical review — Phase 3 and Phase 6 were already complete despite the prior version still listing their contents as "Upcoming"; added the previously-unlisted Client Lifecycle domain. Adopted a phase-level-only, refresh-at-milestone-boundaries policy going forward to prevent the drift that caused this correction to be needed. |
| 2.1.0 | 2026-08-09 | Corrected against actual code state via a 2026-08-09 birds-eye audit: Phase 4 was still "❌ Not Started, no code exists" despite `cap-buyer-leads-001`/`cap-transactions-001` both being `status: active` with real shipped work since 2026-07-28/2026-08-04 — the most consequential finding, since it's a flatly wrong claim, not merely outdated. Phase 2 (CRM) and Phase 5 (Notifications) also refreshed from "Barely Started" to reflect real shipped scope. This is exactly the phase-boundary trigger this doc's own 2.0.0 policy anticipated — Buyer Operations and Transactions crossing from 0 to substantially-built is a real phase-level milestone, not per-tracer-bullet noise. |
