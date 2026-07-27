# DS-001 — Platform Foundation: Identity & Workspace

**Status:** Draft
**Version:** 2.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-27

---

## Purpose

Define Workspace and Identity as business entities — what a Workspace is, what a user's
membership in one means, and how a new user gets associated with a Workspace — ahead of the
Data Dictionary (DD-001) and SQL migration that implement them.

---

## Scope

Covers: the Workspace entity, the Profile entity (a user's identity within Residoro, extending
Supabase Auth), and the minimal role concept needed for baseline tenant isolation. Does not
cover: the Permission Engine's fine-grained role/permission model (separate, later milestone —
see `mil-platform-foundation-001`'s `semantic_scope`), invite-to-existing-workspace flows,
or CRM-domain identity (Contacts/Companies — see CTX-002's CRM business domain, a different
concern from platform Identity).

---

## Business Entities

### Workspace

The isolation unit — CTX-007's Glossary defines Workspace as "an isolated operational
environment belonging to a single brokerage." Every brokerage using Residoro has exactly one
Workspace (for now — multi-workspace-per-brokerage is not a requirement this milestone
addresses). Every tenant-scoped table elsewhere in the platform (`properties`, and later
`listings`, `import_batches`, etc.) references a Workspace via a `tenant_id` column — see the
naming note below.

### Profile

A user's identity within a specific Workspace. 1:1 with Supabase Auth's `auth.users` — Auth is
the source of truth for credentials/login; `profiles` is where Residoro-specific identity data
(which Workspace, what role) lives, because `auth.users` is a Supabase-managed table Residoro
doesn't (and shouldn't) directly extend with business columns.

### Role

Originally two values (`admin`, `member`); a third, **`operator`**, was added by
`tb-client-lifecycle-operator-access-001` (2026-07-22) — a platform-wide role, not scoped to any
Workspace (`tenant_id` is null for operators). Operators act across every tenant via the
backend's service-role client, not via RLS-scoped access. `admin` can manage the Workspace
itself and delete records; `member` has standard tenant-scoped read/write. Still intentionally
coarse — no per-domain, per-action permission model exists (the Permission Engine referenced in
CTX-002/CTX-006's roadmap remains unbuilt).

### Client Lifecycle (added 2026-07-22, `cap-client-lifecycle-001`)

A Workspace now carries its own lifecycle state, layered on top of the entities above:
`contract_start_date`/`contract_end_date` (recorded at enrollment), `access_state`
(`active`/`read_only`/`blocked`, transitioned by a daily automated check as the contract nears
and passes its end date), and per-Workspace policy toggles (`exclusivity_hard_block`,
`rollback_window_hours`) an operator can configure per brokerage. See DD-001 for exact columns
and ADR/TS docs for the enforcement mechanism (Edge Function + `pg_cron`, not a DB trigger).

---

## Naming Note: "Tenant" vs. "Workspace"

CTX docs and the Glossary (CTX-007) use **Workspace** as the business term for the isolation
unit. The Registry's existing capability docs (`cap-properties-001`, `cap-migration-001`,
`cap-listings-001`) all already use the column name **`tenant_id`** on every tenant-scoped
table. Rather than introduce a second column name (`workspace_id`) that would diverge from
three already-written capability schemas, this foundation keeps the SQL column named
`tenant_id` everywhere — including on `profiles` — while the table it references is named
`workspaces` (matching the business term). "Tenant" and "Workspace" refer to the same entity;
this is a naming synonym, not two different concepts.

---

## Key Decision: Workspace Provisioning on Signup (originally a placeholder; partially resolved)

**Original decision (2026-07-21):** on signup, a brand-new Workspace is automatically created,
and the signing-up user becomes its `admin` — a placeholder pending an invite-to-existing-
workspace flow, flagged explicitly as not a final product decision.

**Resolved, 2026-07-22 (`tb-client-lifecycle-enrollment-001`):** the invite path now exists —
an operator enrolling a new client (`POST /admin/clients`) invites that brokerage's first admin
into an *existing* Workspace via `raw_user_meta_data->>'tenant_id'`, not a fresh auto-created
one. The original auto-create-a-new-Workspace-on-signup branch is **not removed** — it remains
`handle_new_user()`'s default/fallback branch for any signup that isn't an operator invite or a
client-enrollment invite (see DD-001). In practice, per `cap-client-lifecycle-001`'s invite-only
model, there is no real public signup path that reaches this fallback branch today; it stays a
placeholder for a hypothetical direct-signup flow, not something currently in use.

---

## Related Documents

- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- DD-001 — Workspaces & Profiles (implements this doc)
- CTX-002 — Product Architecture (Identity business domain)
- CTX-007 — Glossary ("Workspace")
- `cap-client-lifecycle-001` (Theos Registry) — the invite-only enrollment model layered on top of this foundation
- `mil-platform-foundation-001` (theos-registry) — the Registry milestone this implements

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial draft, written alongside DD-001 and the platform foundation migration. |
| 2.0.0 | 2026-07-27 | Refreshed from a birds-eye technical review: documented the `operator` role and Client Lifecycle state layered on top of Workspace/Profile; resolved the signup-provisioning placeholder note (invite path now exists, auto-create branch remains an unused fallback). Structural revision, hence major version bump per STD-002. |
