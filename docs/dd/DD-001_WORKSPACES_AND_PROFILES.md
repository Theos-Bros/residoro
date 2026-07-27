# DD-001 — Workspaces & Profiles

**Status:** Draft
**Version:** 2.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-27

---

## Purpose

Exact table/column/constraint definitions for `workspaces`, `profiles`, and
`contract_notifications`, as implemented across `supabase/migrations/20260721120000_platform_foundation.sql`
and nine follow-up migrations through 2026-07-27 (see Revision History).

---

## Scope

Covers the `public.workspaces`, `public.profiles`, and `public.contract_notifications` tables,
their trigger-based provisioning on signup, and their RLS policies. Does not cover `properties`
(see DD-002) or any other table.

---

## Table: `workspaces`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `name` | `text` | not null | Set from signup metadata or a default at creation time |
| `contract_start_date` | `date` | not null | Added by `tb-client-lifecycle-enrollment-001`. Set at enrollment via `POST /admin/clients`; backfilled from `created_at` for pre-existing rows |
| `contract_end_date` | `date` | not null | Same migration. Read by `tb-client-lifecycle-contract-expiry-001` to drive warnings/enforcement |
| `access_state` | `text` | not null, default `'active'`, `check (access_state in ('active','read_only','blocked'))` | Added by `tb-client-lifecycle-contract-expiry-001`. Set only by the `contract-expiry-check` Edge Function, never directly by a normal route. `active` = normal; `read_only` = past `contract_end_date`, within the 7-day grace period (writes blocked, reads/export ok); `blocked` = grace period elapsed (login itself rejected). Enforced in `application/backend/src/lib/auth.ts` `requireAuth` |
| `warning_30d_sent_at` | `timestamptz` | nullable | Idempotency flag — the 30-day contract-expiry warning fires at most once per contract period, cleared on renewal |
| `warning_7d_sent_at` | `timestamptz` | nullable | Same pattern, 7-day threshold |
| `warning_1d_sent_at` | `timestamptz` | nullable | Same pattern, 1-day threshold |
| `exclusivity_hard_block` | `boolean` | not null, default `false` | Added by `tb-listings-exclusivity-hardblock-001`. `true` turns a conflicting-exclusive-listing activation into a hard 409 instead of a soft warning. Operator-set only, via `PATCH /admin/clients/:id/listings-policy` |
| `rollback_window_hours` | `integer` | not null, default `24`, `check (rollback_window_hours > 0)` | Added by `tb-migration-rollback-window-001`. Read once at import-batch-creation time to compute that batch's `rollback_deadline` — changing this value does not retroactively affect batches already created |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

## Table: `profiles`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, FK → `auth.users(id)` on delete cascade | Same id as the Supabase Auth user — 1:1, not a separate identity |
| `tenant_id` | `uuid` | FK → `workspaces(id)` on delete set null | See DS-001's naming note: "tenant" = "workspace". Null for `operator` role — operators act across all tenants via the backend's service-role client, not via RLS-scoped access |
| `role` | `text` | not null, default `'member'`, `check (role in ('admin','member','operator'))` | `'operator'` added by `tb-client-lifecycle-operator-access-001`. Column default is `'member'` (fail-safe); the signup trigger explicitly inserts the correct role per branch (see Signup Provisioning below) — the default only matters for any future insert path that omits the value. Mutable only via the trigger or service-role access, never by the profile owner directly |
| `handle` | `text` | not null, unique | Added by `tb-accounts-handle-001`. Auto-assigned at account creation via `generate_unique_handle()` (lowercased email local-part, numeric suffix on collision). No client-facing rename endpoint by design — a platform admin edits this column directly in Supabase if it ever needs to change. The stable cross-tenant identifier `tb-listings-co-broker-share-001` uses to name a docket recipient |
| `full_name` | `text` | nullable | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Index: `idx_profiles_tenant_id` on `profiles(tenant_id)`.

## Table: `contract_notifications`

Added by `tb-client-lifecycle-contract-expiry-001`. Side-panel warning notifications, written by
the `contract-expiry-check` Edge Function, read/dismissed via `GET`/`POST /me/...` backend
routes.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` on delete cascade | |
| `threshold` | `text` | not null, `check (threshold in ('30d','7d','1d'))` | |
| `message` | `text` | not null | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `dismissed_at` | `timestamptz` | nullable | |

Indexes: `idx_contract_notifications_tenant` on `(tenant_id)`;
`idx_contract_notifications_tenant_undismissed` on `(tenant_id) where dismissed_at is null`.

RLS: enabled, **no policies, no grants to `anon`/`authenticated`** — same "service-role-only"
posture as `migration_temp_files` (see DD-003). Every access goes through the backend API.

---

## Signup Provisioning: `handle_new_user()`

Trigger function, fires `after insert on auth.users`, `SECURITY DEFINER`. Grown incrementally
across four migrations (platform foundation → operator role → client enrollment → profiles
handle) into four branches, checked in this order:

1. **Operator** (`raw_user_meta_data->>'app_role' = 'operator'`) — inserts a `profiles` row
   with `tenant_id = null`, `role = 'operator'`. Only ever created via the service-role
   `create-operator.ts` script; there is no public path that can set `app_role`.
2. **Invited into an existing workspace** (`raw_user_meta_data->>'tenant_id'` set) — inserts a
   `profiles` row with `role = 'admin'` against that `tenant_id`. Only `POST /admin/clients`
   (enrollment) ever sets this metadata key.
3. **Direct signup (default/placeholder)** — auto-creates a new `workspaces` row (name from
   `raw_user_meta_data->>'workspace_name'` or a default of `"{email}'s Workspace"`,
   `contract_start_date`/`contract_end_date` both set to `current_date`) and makes the signing-up
   user its `admin`. See DS-001's "Key Decision" section — this branch is a flagged placeholder,
   not a final invite/onboarding design; Residoro has no real public signup path (see
   `cap-client-lifecycle-001`'s invite-only model).

Every branch also calls `generate_unique_handle(new.email)` and inserts the result into
`profiles.handle` (added by `tb-accounts-handle-001`).

**Known gap, discovered via real usage (2026-07-21):** deleting a user (`auth.users` row)
cascades `profiles` away (`on delete cascade`), but does **not** clean up the `workspaces` row
that user's signup created — confirmed by testing: creating and then deleting an account left
an orphaned `workspaces` row with no members. Not fixed here; needs a product decision first
(delete the workspace when its last member leaves? require ownership transfer instead?) before
adding a cleanup trigger — flagging so it isn't mistaken for an oversight nobody noticed.

**Auth confirmation setting (2026-07-21):** `mailer_autoconfirm` is set to `true` on the
Residoro Prototype project (dashboard: Authentication → Email → "Confirm email" off). This
was a deliberate fix for Supabase's default email-sending rate limit (2/hour) blocking
repeated signups during testing — without custom SMTP configured, every signup otherwise
tries to send a confirmation email and quickly exhausts that limit. Auto-confirming means
anyone can sign up with any email address without proving ownership of it — acceptable for a
prototype under our own testing, but **revisit before any real user-facing launch** (either
configure custom SMTP and re-enable confirmation, or keep autoconfirm only for pre-launch
internal testing).

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
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260721120000_platform_foundation.sql` — implements the original `workspaces`/`profiles` shape
- `supabase/migrations/20260721121500_platform_foundation_hardening.sql`,
  `20260721122500_platform_foundation_hardening_fix.sql` — post-apply advisor fixes
- `supabase/migrations/20260722100000_operator_role.sql` — `operator` role
- `supabase/migrations/20260722110000_client_enrollment.sql` — contract dates, invited-workspace branch
- `supabase/migrations/20260722120000_contract_expiry.sql` — `access_state`, warning flags, `contract_notifications`
- `supabase/migrations/20260723100000_profiles_handle.sql` — `handle`
- `supabase/migrations/20260725100000_listings_exclusivity_hardblock.sql` — `exclusivity_hard_block`
- `supabase/migrations/20260726120000_migration_rollback_window.sql` — `rollback_window_hours`

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial version, matching the first platform foundation migration. |
| 2.0.0 | 2026-07-27 | Refreshed from a birds-eye technical review: added `operator` role, `handle`, `workspaces` contract/access-state/warning columns, `exclusivity_hard_block`, `rollback_window_hours`, and the `contract_notifications` table. Documented all four `handle_new_user()` branches. Structural revision (new table added), hence major version bump per STD-002. |
