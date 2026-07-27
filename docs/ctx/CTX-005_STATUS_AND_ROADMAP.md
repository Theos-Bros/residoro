# CTX-005 — Status & Roadmap

**Status:** Approved
**Version:** 2.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-20
**Last Updated:** 2026-07-27
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

# Current Phase: Mixed — Phases 0–1 substantially complete, Phase 3 and Phase 6 complete, Phases 2 and 5 barely started, Phases 4 and 7 not started

Unlike the original phase-by-phase framing (which implied strict sequential progress), actual
delivery jumped ahead unevenly — Property Engine (Phase 3) and Migration Platform (Phase 6)
are both fully built while CRM (Phase 2) and Automation (Phase 5) are barely started. See the
per-phase status below.

---

# Phase Status

## Phase 0 — Repository Foundation ✅ Complete

Documentation structure, engineering standards, initial ADRs.

## Phase 1 — Database Design, Identity, Workspace — ✅ Mostly Complete

Database design, Identity, and Workspace are built (DS-001/DD-001, ADR-001/002/003). Core
Entities is a moving target rather than a single milestone — see later phases for what actually
shipped. **Permissions remains not built** — the Permission Engine (fine-grained, per-domain,
per-action) is still a scoped-out future milestone.

## Phase 2 — CRM: Contacts, Companies, Buyers, Sellers — ⚠️ Barely Started

Only Contacts exists (DS-005/DD-005), scoped narrowly for migration purposes. Companies,
Buyers, and Sellers as distinct CRM concepts don't exist.

## Phase 3 — Property Engine, Verification, Media, Documents, Listings, Authority to Sell — ✅ Complete

Fully built: Properties, Projects/Developers/Unit Types, bulk unit generation, Media (photos),
Documents (title/tax), Verification workflow, Listings (full lifecycle), Authority to
Sell/Lease (exclusivity, term dates, per-workspace policy), cross-brokerage docket sharing. See
DD-002, DD-006, DD-007, DD-008; DS-002, DS-004, DS-007, DS-008.

## Phase 4 — Buyer Operations, Seller Operations, Matching, Viewings, Offers, Transactions — ❌ Not Started

No code exists for any of this.

## Phase 5 — Automation, Workflow Engine, Notifications, Reporting, Dashboards — ⚠️ Barely Started

Three narrow automated-notification checks exist (contract expiry, training reminders, listing
authority expiry — see TS-003), not a general workflow/automation engine. No reporting or
dashboards exist.

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
- RFC-001, RFC-002, RFC-003 — open infrastructure/architecture decisions affecting what's next
- CTX-006 — Roadmap (deprecated, merged into this document)

---

# Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-20 | Initial project snapshot (as CTX-005 "Current Status"). |
| 2.0.0 | 2026-07-27 | Merged with CTX-006 (Roadmap) into one strategic status+roadmap document, retitled "Status & Roadmap." Corrected against actual code state via a birds-eye technical review — Phase 3 and Phase 6 were already complete despite the prior version still listing their contents as "Upcoming"; added the previously-unlisted Client Lifecycle domain. Adopted a phase-level-only, refresh-at-milestone-boundaries policy going forward to prevent the drift that caused this correction to be needed. |
