# DS-001 — Platform Foundation: Identity & Workspace

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-21

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

### Role (minimal, this milestone only)

Two values: `admin` and `member`. `admin` can manage the Workspace itself and delete records;
`member` has standard tenant-scoped read/write. This is intentionally coarse — enough to
gate the handful of admin-only actions this foundation needs (renaming a Workspace, deleting a
Property), not a general permissions model. The full Permission Engine (per-domain,
per-action, configurable roles — referenced in CTX-002 and CTX-006's roadmap) is out of scope
here.

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

## Key Decision: Workspace Provisioning on Signup (flagged as a placeholder)

**Decision:** on signup, a brand-new Workspace is automatically created, and the signing-up
user becomes its `admin`. Every signup is a new brokerage until an invite-to-existing-workspace
flow exists.

**Why:** this is the only option that satisfies the requirement that "a user can sign up / sign
in via Supabase Auth and is associated with exactly one tenant" without first building an
invite system — which is explicitly out of scope for this foundation slice.

**This is a placeholder, not a final product decision.** Once an invite flow exists (a
teammate joining an existing brokerage's Workspace), this default should be revisited — likely
gated behind whether the signup included an invite token. Flagging here so it isn't mistaken
for a considered final answer if read in isolation later.

---

## Related Documents

- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- DD-001 — Workspaces & Profiles (implements this doc)
- CTX-002 — Product Architecture (Identity business domain)
- CTX-007 — Glossary ("Workspace")
- `mil-platform-foundation-001` (theos-registry) — the Registry milestone this implements

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial draft, written alongside DD-001 and the platform foundation migration. |
