# DD-010 — Transactions: Viewings

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-08-04
**Last Updated:** 2026-08-04

---

## Purpose

Exact table/column/constraint definitions for `public.viewings`, as implemented by
`tb-transactions-viewings-001` (`supabase/migrations/20260804100000_transactions_viewings.sql`).
Written at implementation time — per RFC-004's documentation cadence requirement — rather than
retroactively, unlike most of this repo's earlier DD docs.

---

## Scope

Covers `public.viewings` only. Does not cover `buyer_requirements` (DD not yet written — see
`cap-buyer-leads-001`'s own noted DS/DD coverage gap) or `listings` (DD-006). Does not cover
Offers, Contracts, or Closing — those are separate, not-yet-built tracer bullets under the same
parent capability (`cap-transactions-001`), each expected to get its own DD entry when built.

---

## Table: `viewings`

The first real record behind `buyer_requirements.stage = 'viewing'`, previously an inert dropdown
label with nothing stored about what actually happened. Logs a scheduled/completed property
showing against a Lead + Listing pair.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `buyer_requirement_id` | `uuid` | not null, FK → `buyer_requirements(id)` | |
| `listing_id` | `uuid` | not null, FK → `listings(id)` | |
| `scheduled_at` | `timestamptz` | not null | |
| `outcome` | `text` | not null, default `'scheduled'`, `CHECK` in (`scheduled`, `completed`, `no_show`, `cancelled`) | Set on creation, updated after the fact via `PATCH /viewings/:id` |
| `feedback` | `text` | nullable | Free-form notes captured alongside an outcome update |
| `created_by` | `uuid` | FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Indexes: `idx_viewings_tenant_id` on `(tenant_id)`, `idx_viewings_buyer_requirement_id` on
`(buyer_requirement_id)`, `idx_viewings_listing_id` on `(listing_id)`.

---

## Row-Level Security

Tenant-scoped CRUD, matching `buyer_requirements`'s pattern with one deliberate difference:
**no admin-only delete gate**. A viewing log entry is closer to `buyer_requirement_matches`
(operational record, tenant-wide delete) than to `buyer_requirements`/`contacts` (core record,
admin-only hard delete) — a mis-scheduled viewing is expected to be correctable by whoever
logged it, not gated behind an admin.

| Policy | Rule |
|---|---|
| `viewings_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `viewings_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `viewings_update_tenant` | `update` where/with check `tenant_id = current_tenant_id()` |
| `viewings_delete_tenant` | `delete` where `tenant_id = current_tenant_id()` |

`authenticated` granted `select, insert, update, delete`. `service_role` has full access.
Written on the per-request scoped client throughout (`viewings.ts`), consistent with
ADR-003's scoped-client enforcement pattern — no `service_role`/`supabaseAdmin` use in this
tracer bullet's route handlers.

---

## Server-Side Behavior Beyond the Schema

Scheduling a Lead's first viewing (`POST /viewings`) advances `buyer_requirements.stage` to
`'viewing'` — but only if the Lead's current stage sorts earlier than `'viewing'` in the fixed
9-stage order `buyer_requirements` already uses (`registered → searching → stalled →
options_sent → viewing → negotiating → contract_closing → won → lost`). A Lead already at
`negotiating` or later is never regressed by scheduling a later/duplicate viewing. This mirrors
every other stage-auto-advance in the codebase (the `searching`, `options_sent`, and `won`
auto-advances in `buyerRequirements.ts`/`matching.ts`) and reuses the same
`createStageChangeTask` mechanism (`cap-tasks-001`) those paths already call, so a viewing-driven
stage change generates the same per-stage routed task as a manual one.

---

## Related Documents

- `cap-transactions-001` (Theos Registry) — parent capability
- `tb-transactions-viewings-001` (Theos Registry) — the tracer bullet this DD documents
- DD-006 — Listings & Docket Sharing (the `listings` FK target)
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260804100000_transactions_viewings.sql`

---

## Revision History

| Version | Date | Description |
|---------|------|--------------|
| 1.0.0 | 2026-08-04 | Initial version, written alongside implementation per RFC-004. |
