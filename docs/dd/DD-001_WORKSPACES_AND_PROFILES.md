# DD-001 — Workspaces & Profiles

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-21

---

## Purpose

Exact table/column/constraint definitions for `workspaces` and `profiles`, as implemented by
`supabase/migrations/20260721120000_platform_foundation.sql`.

---

## Scope

Covers the `public.workspaces` and `public.profiles` tables, their trigger-based provisioning
on signup, and their RLS policies. Does not cover `properties` (see DD-002).

---

## Table: `workspaces`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `name` | `text` | not null | Set from signup metadata or a default at creation time |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

## Table: `profiles`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, FK → `auth.users(id)` on delete cascade | Same id as the Supabase Auth user — 1:1, not a separate identity |
| `tenant_id` | `uuid` | FK → `workspaces(id)` on delete set null | See DS-001's naming note: "tenant" = "workspace" |
| `role` | `text` | not null, default `'member'`, `check (role in ('admin','member'))` | Column default is `'member'` (fail-safe); the signup trigger explicitly inserts `'admin'` for the workspace creator — the default only matters for any future insert path that omits the value |
| `full_name` | `text` | nullable | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Index: `idx_profiles_tenant_id` on `profiles(tenant_id)`.

---

## Signup Provisioning: `handle_new_user()`

Trigger function, fires `after insert on auth.users`, `SECURITY DEFINER`. On every new Auth
signup: creates a new `workspaces` row (name from `raw_user_meta_data->>'workspace_name'` or a
default of `"{email}'s Workspace"`), then creates the corresponding `profiles` row with
`role = 'admin'`. See DS-001's "Key Decision" section — this is a flagged placeholder, not a
final invite/onboarding design.

---

## Row-Level Security

Both tables have RLS enabled. Two `SECURITY DEFINER` helper functions back every policy:
`current_tenant_id()` and `current_role()` (defined once, shared with `properties` — see
ADR-002 for why they must be `SECURITY DEFINER` with `search_path = ''`).

| Table | Policy | Rule |
|---|---|---|
| `workspaces` | `workspaces_select_own` | `select` where `id = current_tenant_id()` |
| `workspaces` | `workspaces_update_admin` | `update` where `id = current_tenant_id()` and `current_role() = 'admin'` |
| `profiles` | `profiles_select_same_tenant` | `select` where `tenant_id = current_tenant_id()` (teammates visible to each other) |
| `profiles` | `profiles_update_own` | `update` where `id = auth.uid()` |

**Column-level grant, not a blanket one, on `profiles`:** `authenticated` is granted
`update (full_name)` only — not a blanket `update`. A blanket grant combined with
`profiles_update_own`'s row-level check would let a user change their *own* `role` or
`tenant_id` via a client-side update (RLS restricts which row, not which column). `role` and
`tenant_id` are mutable only via the `SECURITY DEFINER` signup trigger or direct service-role
access. See ADR-002's Consequences section for the full reasoning.

`workspaces` gets no `insert` grant for `authenticated` — the only path that creates a
workspace row is the signup trigger, which runs as `SECURITY DEFINER` and needs no grant.

---

## Post-Apply Hardening (Supabase Advisor Findings)

`get_advisors` run immediately after applying the migration flagged: (1) `current_tenant_id()`
and `current_role()` and the two trigger functions were executable by `anon` beyond what's
needed, and (2) one RLS policy (`profiles_update_own`) called `auth.uid()` directly instead of
`(select auth.uid())`, causing per-row re-evaluation instead of once per query. Both fixed via
follow-up migrations rather than hand-editing the applied one:
`20260721121500_platform_foundation_hardening.sql` and, after the first attempt didn't fully
close the `anon` gap (Supabase grants EXECUTE to `anon`/`authenticated` directly on new
functions, independent of the `PUBLIC` pseudo-role — revoking from `PUBLIC` alone doesn't
revoke a role's own separate grant), `20260721122500_platform_foundation_hardening_fix.sql`.

**Accepted residual advisor warning:** `current_tenant_id()`/`current_role()` remain directly
callable by `authenticated` via `/rest/v1/rpc/...` — this is required for RLS to work at all
(every tenant-scoped policy calls them), not an oversight. Calling them directly just returns
the caller's own `tenant_id`/`role`, which they already know — no cross-tenant data is
reachable this way. See ADR-002's Consequences section.

---

## Related Documents

- DS-001 — Platform Foundation: Identity & Workspace (business-entity source for this DD)
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- `supabase/migrations/20260721120000_platform_foundation.sql` — implements this doc
- `supabase/migrations/20260721121500_platform_foundation_hardening.sql`,
  `20260721122500_platform_foundation_hardening_fix.sql` — post-apply advisor fixes

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial version, matching the first platform foundation migration. |
