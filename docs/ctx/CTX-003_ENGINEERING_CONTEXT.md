# CTX-003 — Engineering Context

**Status:** Approved  
**Version:** 2.0.0  
**Owner:** Residoro Engineering  
**Created:** 2026-07-20  
**Last Updated:** 2026-07-27

**Correction notice (2026-07-27):** the Technology Stack section below stated the frontend is
**WeWeb** (a no-code builder) — this was true only very early on and was dropped shortly after
this document was written. The frontend has been a directly-coded React + TypeScript
application since. This document is read first by anyone or any AI onboarding onto this
codebase, and the stale claim was never corrected until this birds-eye review found it —
flagging explicitly so the correction isn't missed, and so a similar stack claim is verified
against actual code (`application/frontend/package.json`, `application/backend/package.json`)
before being trusted again in the future, not just read from this document.

---

# Purpose

This document defines the engineering philosophy, architectural constraints, technology stack, and development methodology of Residoro.

It answers the question:

> **How is Residoro engineered?**

While CTX-001 defines why the platform exists and CTX-002 defines what the platform is, this document establishes the engineering principles that guide implementation.

---

# Scope

This document covers:

- Engineering philosophy
- Platform architecture
- Technology stack
- Repository organization
- Development methodology
- Scalability principles
- Security principles
- Development workflow

Implementation details for specific features are documented elsewhere.

---

# Related Documents

- CTX-001 — Project Context
- CTX-002 — Product Architecture
- CTX-004 — AI Guidelines
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `docs/ts/` — TS-001 through TS-004, implementation-level architecture detail this document summarizes
- `docs/api/` — the HTTP contract
- `docs/rfc/` — RFC-001/002/003, open infrastructure/architecture decisions

**Numbering note (2026-07-27):** this document originally referenced "ADR-003 — Configuration
Over Customization," "ADR-004 — Documentation-First Development," "ADR-005 — AI-Assisted
Migration," and "ADR-006 — Workspace Naming Convention" — none of these were ever written as
actual files. Per the precedent ADR-002 itself already set ("since no ADR files existed before
this one, CTX-003's numbering was adopted as authoritative"), the same rule applies in reverse
here: ADR-003 is now a real, written decision (Scoped-Client Enforcement, unrelated to
"Configuration Over Customization"). The four originally-planned-but-never-written ADRs are
removed from this list rather than left as dangling references — if any of that content is
written later, it takes the next available number, not a reserved one.

---

# Engineering Philosophy

Residoro is engineered as a long-term Software-as-a-Service platform.

Engineering decisions prioritize:

- Simplicity
- Maintainability
- Scalability
- Security
- Customer trust
- Low operational overhead

The platform is designed to support thousands of brokerages without requiring architectural redesign.

---

# Engineering Principles

Development follows this sequence:

Business Process

↓

User Workflow

↓

Business Entities

↓

Relationships

↓

Permissions

↓

Automation

↓

Database

↓

APIs

↓

Frontend

User interfaces should reflect business architecture rather than define it.

---

# Platform Architecture

Residoro uses a shared-schema multi-tenant architecture.

Each brokerage operates within its own isolated workspace while sharing a common PostgreSQL schema.

Isolation is enforced through:

- Workspace ownership
- Row Level Security (RLS)
- Role-based permissions
- Application-level authorization

---

# Technology Stack

**As implemented, 2026-07-27** — see TS-001/TS-002 for full architecture detail.

## Frontend

- React 18 + TypeScript, Vite 5
- React Router DOM 6 (nested layout routes, two independently-gated trees: brokerage + admin)
- Tailwind CSS 3, shadcn/ui-pattern components (Radix primitives)
- No state-management or data-fetching library — hand-rolled `useState`/`useEffect`/`fetch()`
  throughout (see TS-002's Known Gaps)
- Directly coded, not a no-code/low-code builder — see the correction notice above

Business logic stays minimal by convention (all data operations go through the Fastify backend,
never a direct Supabase table call from the frontend — see TS-002) rather than by tooling
constraint.

---

## Application Backend

- Node.js + TypeScript, Fastify 5
- No versioning prefix on routes, no schema-validation library, no centralized error handler —
  see TS-001 for the full pattern and its known gaps

## Backend-as-a-Service

- Supabase

Provides:

- PostgreSQL
- Authentication
- Row Level Security
- Storage
- Edge Functions (used for three daily automated checks — see TS-003)
- `pg_cron`/`pg_net` (dispatch mechanism for those checks)

**Realtime is not currently used anywhere in the codebase**, despite being listed as a provided
capability — flagging so it isn't assumed to be wired up.

---

## Database

- PostgreSQL 17 (Supabase-managed)

The database is the authoritative source of business data. See `docs/dd/` (schema) and
`docs/ds/` (business-entity design) for the full current data model — 9 DD documents, covering
19 tables as of 2026-07-27.

**RLS is not currently the operative tenant-isolation enforcement mechanism** for any real
request — every backend route uses the service-role client, which bypasses RLS entirely; tenant
scoping is enforced by explicit application-code filtering instead. See ADR-002's "Superseded
By (partial)" note and ADR-003 for the corrected target architecture (not yet implemented).
"Business rules should be enforced at the database and backend layers whenever practical" below
remains the intended principle — it just isn't fully realized yet for the RLS layer specifically.

---

## AI Integration

**As implemented, 2026-07-27**: there is currently **no live AI/LLM call anywhere in the
application backend or frontend**. The original migration field-mapping design called an AI
provider in-app; that was replaced (`tb-migration-manual-mapping-001`) with a deterministic
header-string matcher (`directMatchHeaders()`, see TS-004) plus an external Claude session an
operator runs outside the app for pre-mapping and detail extraction. No customer-provided
API-key storage/encryption mechanism exists in the schema — there was nothing built for it to
store, since no in-app AI call currently needs one.

**As originally envisioned** (kept here as the stated future direction, not current state):
Residoro would support customer-provided AI providers (OpenAI, Anthropic, Google Gemini) with
keys under customer control, encrypted at rest — this remains a plausible future direction, not
a currently-implemented capability. Any future work reviving this should re-verify current code
rather than assume this original framing still holds.

---

# Multi-Tenant Model

Residoro does not create separate databases or schemas per brokerage.

Instead:

- One database
- One shared schema
- Workspace isolation
- Tenant-aware business logic

This model simplifies maintenance while remaining highly scalable.

---

# Security Principles

Security is a product feature.

Engineering decisions should prioritize:

- Least privilege
- Secure defaults
- Auditability
- Data ownership
- Encryption
- Workspace isolation

---

# Configuration Philosophy

Whenever practical:

Configuration should replace code.

Business rules should be configurable through database records rather than hardcoded values.

Examples include:

- Pipelines
- Statuses
- Roles
- Permissions
- Automation rules
- Custom fields

---

# Migration Philosophy

Migration is treated as a core capability.

Residoro should support migration from:

- Notion
- Spreadsheets
- Legacy CRMs
- Custom databases

Imports should use:

- Staging
- Validation
- Mapping
- Preview
- User approval

Production data should never be modified without validation.

---

# Repository Organization

The repository is *intended* to separate documentation, application code, infrastructure,
operations, tooling, and archived assets — `README.md`'s repo-structure diagram lists
`.github/`, `infrastructure/`, `operations/`, `tools/`, `archive/`. **As of 2026-07-27, none of
these five directories exist on disk** — only `docs/`, `application/`, and `supabase/` are real.
This is tracked as a concrete action item in RFC-001 (baseline CI under `.github/workflows/`);
the other four remain aspirational until something actually needs to live in them.

Documentation precedes implementation as a principle — largely upheld for the database layer
(`docs/dd/`, `docs/ds/` stayed current with schema changes throughout, per DD-004 through
DD-009's retroactive-but-complete coverage) but not for the CTX layer itself, which is what this
2026-07-27 review exists to correct.

---

# Development Workflow

Major implementation work should follow:

1. Business process definition
2. Architecture decision
3. Engineering standards
4. Database specification
5. Data dictionary
6. SQL migration
7. Backend implementation
8. Frontend implementation
9. Testing
10. Documentation updates

---

# Testing Philosophy

Testing should occur at multiple levels: database constraints, RLS policies, backend logic, API
behavior, frontend workflows, end-to-end business scenarios.

**As implemented, 2026-07-27: zero automated tests exist anywhere in the codebase** (no
`*.test.*`/`*.spec.*` files, confirmed by a full repo search). Every tracer bullet has instead
been manually verified via one-off seed scripts (`application/backend/src/scripts/create-*-
verify-account.ts`, six of them) and live walkthroughs. This has worked so far — a 2026-07-27
Registry-vs-code audit found no drift between what's documented as shipped and what's actually
in the codebase — but it's a real gap for "business-critical workflows should be validated
before release" as stated intent, not yet realized as practice. Not resolved by this review;
flagging as a known gap rather than silently leaving the stated philosophy uncorrected.

---

# Deployment Philosophy

Development should progress through controlled environments: Development → Testing → Staging →
Production.

**As implemented, 2026-07-27**: only one environment exists — a single `main` branch, one
Supabase project, no staging, no CI, and no deployment configuration of any kind checked into
the repo (deploys are manual and undocumented). RFC-001 (Approved) resolved this deliberately,
not by oversight: staging is explicitly deferred until closer to real client onboarding, with a
manual deploy runbook written in the meantime and hosting (Vercel + Render/Fly.io) chosen for
when it's built. RFC-003 (Approved) bundles a fresh Supabase project migration with that same
hosting cutover. See both RFCs for the full reasoning and decision record.

Database migrations are version-controlled (`supabase/migrations/`, 26 files as of 2026-07-27)
— that half of this principle is upheld in practice.

---

# Success Criteria

Residoro's engineering architecture succeeds when it:

- Scales to thousands of workspaces.
- Protects customer data.
- Supports rapid feature development.
- Maintains consistent architecture over time.
- Enables safe migrations and upgrades.

---

# Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-20 | Initial version. |
| 2.0.0 | 2026-07-27 | Corrected from a birds-eye technical review: Technology Stack was stating the frontend as WeWeb (dropped early on; actual frontend is directly-coded React) and AI Integration as customer-provided-key-based (no live AI call exists in-app currently). Removed four never-written ADR references and documented the ADR-003 numbering collision. Flagged Repository Organization, Testing Philosophy, and Deployment Philosophy sections as stating intent not yet fully realized in current practice, with specifics. Structural/factual correction, hence major version bump per STD-002. |