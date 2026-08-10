# DD-001 — Workspaces & Profiles

**Status:** Draft
**Version:** 2.9.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-08-10

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
| `first_name` | `text` | nullable | Added by `tb-user-profile-name-split-001` (2026-08-10), replacing `full_name`. Required at the API layer (`PATCH /me/profile`); nullable at the DB layer only because pre-existing rows were backfilled best-effort (split `full_name` on its first space) |
| `last_name` | `text` | nullable | Same migration. Optional — a single-token name backfills into `first_name` with `last_name` left null, same rule `handle_new_user()` follows for new signups |
| `prefix` | `text` | nullable | Added by `tb-user-profile-email-prefix-001` (2026-08-10). Free-text professional/courtesy title (e.g. "Atty.", "Broker") — no fixed list, no format validation. Self-editable, same column-level-grant shape `first_name`/`last_name` now use |
| `position` | `text` | nullable | Added by `tb-employee-position-001` (2026-08-10). Free-text job title (e.g. "Senior Agent"). Originally shipped with no `authenticated` grant at all (admin-set only, via `PATCH /workspace/members/:id/position`). **Reversed same day by `tb-user-profile-position-self-edit-001`:** now also self-editable via `PATCH /me/profile`, same column-level-grant shape `first_name`/`last_name`/`prefix` use — `position` has no access-level implications the way `role`/`tenant_id` do, so gating it at the grant layer was over-scoped. The admin-only route is unchanged and still works; both paths write the same column, last write wins, no locking |
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

**Correction (2026-08-10, `tb-platform-grant-lockdown-001`):** "no grants to anon/authenticated"
wasn't actually true until this date — same un-revoked-default pattern as this doc's own Finding
7, never exploitable here given RLS's zero-policy default-deny. Closed via `supabase/migrations/
20260810210000_tier3_zero_policy_grant_lockdown.sql`.

---

## Signup Provisioning: `handle_new_user()`

Trigger function, fires `after insert on auth.users`, `SECURITY DEFINER`. **Rewritten
2026-07-29** (`20260729090000_fix_signup_privilege_escalation.sql`, corrected same day by
`20260729110000_fix_handle_new_user_handle_column.sql`) to fix a CRITICAL finding in
`docs/security-review-2026-07-29.md` — see that doc for the full exploit and fix narrative.
This section describes the **current, fixed** behavior only.

The trigger now has exactly one branch, regardless of any `raw_user_meta_data` the caller
supplied: it inserts a fully inert `profiles` row (`tenant_id = null`, `role = 'member'`,
`first_name`/`last_name` split from `raw_user_meta_data->>'full_name'` on its first space
(`tb-user-profile-name-split-001`, 2026-08-10 — the metadata key callers send is still
`full_name`, only the trigger's own storage changed), `handle` from
`generate_unique_handle(new.email)`). It never reads `app_role` or `tenant_id` from
`raw_user_meta_data`, and it no longer auto-creates a `workspaces` row for a direct signup —
that branch, along with the operator/invited-admin branches keyed off client-supplied metadata,
was removed entirely.

Real privilege assignment now happens in exactly two trusted, service-role-only call sites,
each immediately after a Supabase Admin API `inviteUserByEmail` call succeeds, keyed by that
call's own returned `auth.users` id (never anything the invitee supplied):

1. **`POST /admin/clients`** (`application/backend/src/routes/admin.ts`) — creates the
   `workspaces` row first, invites the admin email, then `UPDATE profiles SET tenant_id =
   <new workspace id>, role = 'admin' WHERE id = <invite response's user id>`. Rolls the
   workspace back if either the invite or the assignment fails, so no orphaned admin-less
   workspace is left behind.
2. **`create-operator.ts`** (`application/backend/src/scripts/create-operator.ts`) — service-role
   CLI script, invites the email, then `UPDATE profiles SET role = 'operator' WHERE id =
   <invite response's user id>`. The only way an operator account is ever created; requires
   holding `SUPABASE_SERVICE_ROLE_KEY` to run at all.

Why this closes the hole the old version had: `raw_user_meta_data` is the `data` payload of
Supabase Auth's own public `POST /auth/v1/signup` endpoint, reachable with only the publishable
key regardless of whether this app's UI exposes a signup form. The old trigger trusted
`app_role`/`tenant_id` fields from that payload directly, so any unauthenticated caller could
self-grant `operator` or hijack any existing workspace as its admin — proven live in the
2026-07-29 review. The fix means every signup lands inert no matter what metadata is sent;
`requireAuth` already rejects a `tenant_id = null` profile with 401, and `requireOperator`
already rejects a non-`operator` role with 403, so an inert profile has no access to anything.

**Known gap, discovered via real usage (2026-07-21), now moot for new signups:** the old
direct-signup branch could leave an orphaned `workspaces` row behind if the user was later
deleted (`profiles` cascades away, `workspaces` does not). Since direct signup no longer creates
a `workspaces` row at all, this specific gap can't recur going forward — not fixed as a general
cleanup-trigger, just no longer reachable via this path. Any already-orphaned rows from before
2026-07-29 are not addressed by this migration.

**Auth confirmation setting (2026-07-21, still current):** `mailer_autoconfirm` is set to `true`
on the Residoro Prototype project (dashboard: Authentication → Email → "Confirm email" off).
This was a deliberate fix for Supabase's default email-sending rate limit (2/hour) blocking
repeated signups during testing — without custom SMTP configured (still true as of 2026-08-03,
see the infra RFCs), every signup otherwise tries to send a confirmation email and quickly
exhausts that limit. This setting is orthogonal to the privilege-escalation fix above — it
controls whether email ownership is verified, not what role/tenant a new profile gets — but
combined with `handle_new_user()`'s pre-2026-07-29 behavior it made the exploit easier to test
repeatedly. **Revisit before any real user-facing launch.** The 2026-07-29 review's own
"still recommended, not verifiable from code" item — disabling public signup at the Supabase
Auth project level as defense-in-depth — has not been confirmed done.

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
| `profiles` | `profiles_select_own` | `select` where `id = auth.uid()` (added 2026-08-06, see note below) |
| `profiles` | `profiles_update_own` | `update` where `id = auth.uid()` |

**2026-08-06 addition — `profiles_select_own`:** `tb-user-profile-display-name-001` needed a
scoped-client `GET /me/profile` (ADR-003) to work for an operator, not just a tenant user.
`profiles_select_same_tenant` alone couldn't serve that: an operator's `tenant_id` is null, and
`current_tenant_id()` (which looks up the caller's own row) is also null for them, and Postgres
treats `null = null` as not-true — so an operator was blocked from reading even their own row
under RLS. `profiles_select_own` mirrors `profiles_update_own`'s existing shape exactly (`id =
(select auth.uid())`, no tenant_id involved) and is additive — `profiles_select_same_tenant`
still governs teammate-to-teammate visibility unchanged. Migration:
`supabase/migrations/20260806110000_profiles_self_select.sql`.

**Column-level grant, not a blanket one, on `profiles`:** `authenticated` is granted
`update (prefix)` (as of `tb-user-profile-email-prefix-001`, 2026-08-10) and
`update (first_name, last_name)` (as of `tb-user-profile-name-split-001`, same day — this
replaced the original `update (full_name)` grant, revoked in the same migration that dropped
the column) — not a blanket `update`. A blanket grant combined with `profiles_update_own`'s
row-level check would let a user change their *own* `role` or `tenant_id` via a client-side
update (RLS restricts which row, not which column). `role` and `tenant_id` are mutable only via
the `SECURITY DEFINER` signup trigger or direct service-role access. See ADR-002's Consequences
section for the full reasoning. No new RLS policy was needed for any of these — `profiles_
update_own`'s row-level check already covers any column on the caller's own row; enforcement of
*which* columns is entirely the grant's job.

**Correction (2026-08-10) — this section described intent, not reality, for six weeks:** every
migration above only ever ran column-specific `grant update (...)` statements, but `authenticated`
actually held **full table-level UPDATE/INSERT/DELETE/TRUNCATE** on `profiles` the entire time —
Supabase's default privilege behavior for new `public`-schema tables, never explicitly revoked.
Combined with `profiles_update_own`'s row-only RLS check, this meant any member could directly
`UPDATE`	their own `role` to `admin` or `tenant_id` to any other workspace — full account/tenant
takeover, live-proven and fixed same day. See `docs/security-review-2026-07-29.md` Finding 7 for
the full exploit/fix narrative and `supabase/migrations/20260810170000_profiles_grant_lockdown.sql`
(`revoke all` then re-`grant` exactly `select` + `update (first_name, last_name, prefix)`). After
this fix, the paragraph above is finally an accurate description of `profiles`' actual grants —
verified via `information_schema.role_table_grants`/`column_privileges`, not assumed from the
migration files alone.

`workspaces` gets no `insert` grant for `authenticated` — the only path that creates a
workspace row is the signup trigger, which runs as `SECURITY DEFINER` and needs no grant.

**Correction (2026-08-10) — `workspaces` had the same accidental table-wide grant `profiles` did:**
`authenticated` held a full table-wide `update` on `workspaces`
(`20260721120000_platform_foundation.sql:247`, quoted above, never narrowed by any later
migration) — Finding 7's fix for `profiles` deferred this at the time since it was lower severity
(requires already being a legitimate admin of your own tenant, not a full cross-tenant takeover).
Combined with `workspaces_update_admin`'s row-only RLS check, a real tenant admin could
self-edit `access_state`, `contract_end_date`, `exclusivity_hard_block`, or
`rollback_window_hours` directly via PostgREST — all four documented above as
operator/Edge-Function/system-set only. Fixed same day via
`supabase/migrations/20260810180000_workspaces_grant_lockdown.sql`: `revoke all` then re-`grant
select` only — no `update` grant at all, since grepping every `getScopedClient(...).from
('workspaces')` call in `application/backend/src` found exactly one, a read-only `.select()` in
`routes/workspace.ts`. `workspaces_update_admin`'s RLS policy is unchanged but now unreachable via
PostgREST with no grant behind it — the same shape `profiles.position` already uses for
operator/system-only columns. Live-reverified — see
`docs/security-review-2026-07-29.md` Finding 7's "Fix Applied (third pass same day)" note and
`application/backend/src/scripts/verify-workspaces-grant-lockdown.ts`.

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
- `docs/security-review-2026-07-29.md` — the CRITICAL finding `20260729090000_fix_signup_privilege_escalation.sql` fixes
- `supabase/migrations/20260729090000_fix_signup_privilege_escalation.sql`,
  `20260729110000_fix_handle_new_user_handle_column.sql` — current `handle_new_user()`
- `supabase/migrations/20260806110000_profiles_self_select.sql` — `profiles_select_own`
  (`tb-user-profile-display-name-001`, theos-registry)
- `supabase/migrations/20260810140000_profiles_prefix.sql` — `prefix` column and its grant
  (`tb-user-profile-email-prefix-001`, theos-registry)
- `supabase/migrations/20260810150000_profiles_name_split.sql` — `first_name`/`last_name`
  columns replacing `full_name`, the backfill, the grant swap, and the redefined
  `handle_new_user()` (`tb-user-profile-name-split-001`, theos-registry)
- `supabase/migrations/20260810170000_profiles_grant_lockdown.sql` — closes the accidental
  table-wide grant to `authenticated`; see `docs/security-review-2026-07-29.md` Finding 7
- `docs/security-review-2026-07-29.md` — Finding 7 (2026-08-10 addendum): the full
  privilege-escalation exploit/fix narrative this correction summarizes
- `supabase/migrations/20260810160000_profiles_position.sql` — `position` column, deliberately
  no `authenticated` grant (`tb-employee-position-001`, theos-registry)
- `supabase/migrations/20260810180000_workspaces_grant_lockdown.sql` — closes the accidental
  table-wide `update` grant to `authenticated` on `workspaces`; see
  `docs/security-review-2026-07-29.md` Finding 7
- `supabase/migrations/20260810190000_profiles_position_self_edit.sql` — adds `position` to
  `profiles`' self-service column grant (`tb-user-profile-position-self-edit-001`,
  theos-registry)

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial version, matching the first platform foundation migration. |
| 2.0.0 | 2026-07-27 | Refreshed from a birds-eye technical review: added `operator` role, `handle`, `workspaces` contract/access-state/warning columns, `exclusivity_hard_block`, `rollback_window_hours`, and the `contract_notifications` table. Documented all four `handle_new_user()` branches. Structural revision (new table added), hence major version bump per STD-002. |
| 2.1.0 | 2026-08-03 | Rewrote the Signup Provisioning section from a 2026-08-03 birds-eye review — the previous revision described the four-branch `handle_new_user()` that `20260729090000_fix_signup_privilege_escalation.sql` replaced to fix a CRITICAL finding in `docs/security-review-2026-07-29.md`. That section had gone eight days describing a patched vulnerability as current behavior; now describes the single-branch inert-profile trigger and the two trusted invite-then-assign call sites that actually grant privilege. |
| 2.2.0 | 2026-08-06 | Added `profiles_select_own` RLS policy (`tb-user-profile-display-name-001`) — closes a gap where an operator could not read even their own `profiles` row through an RLS-scoped client, since `profiles_select_same_tenant` compares two nulls for a tenant-less operator. Additive, non-structural (no table/column change), hence a minor version bump per STD-002. |
| 2.3.0 | 2026-08-10 | Added `profiles.prefix` column plus its `update (prefix)` grant (`tb-user-profile-email-prefix-001`) — self-editable free-text professional/courtesy title, same grant shape as `full_name`. No new RLS policy needed. Structural (new column), hence a minor version bump per STD-002 (additive column, not a breaking change). |
| 2.4.0 | 2026-08-10 | Replaced `profiles.full_name` with `first_name`/`last_name` (`tb-user-profile-name-split-001`) — existing rows backfilled by splitting on the first space, the `update (full_name)` grant swapped for `update (first_name, last_name)`, and `handle_new_user()` redefined to split incoming `full_name` signup metadata the same way. No new RLS policy needed. Breaking at the column level (a column was dropped, not just added) but every existing API response consumers outside the self-edit surface depend on kept its `full_name` field, now computed server-side — flagged as a minor bump per STD-002 since no external contract broke, only internal storage. |
| 2.5.0 | 2026-08-10 | **Correction, critical.** The "Column-level grant, not a blanket one" paragraph (present since v1.0.0) described intent, not reality: `authenticated` actually held full table-level UPDATE/INSERT/DELETE/TRUNCATE on `profiles` via Supabase's un-revoked default privileges, letting any member self-promote to admin/operator or hijack any tenant via a direct PostgREST write. Fixed same day via `20260810170000_profiles_grant_lockdown.sql` (`revoke all` + precise re-grant). Full narrative in `docs/security-review-2026-07-29.md` Finding 7. Correction to previously-inaccurate documentation, not a new schema change, hence a minor bump per STD-002. |
| 2.6.0 | 2026-08-10 | Added `profiles.position` column (`tb-employee-position-001`) — free-text job title, admin-set only via a service-role route, deliberately no `authenticated` grant at all (the first `profiles` column to follow `role`/`tenant_id`'s access pattern rather than the self-service one). No new RLS policy needed. Structural (new column), hence a minor version bump per STD-002. |
| 2.7.0 | 2026-08-10 | **Correction, critical.** `workspaces` had the same accidental table-wide grant `profiles` did (v2.5.0) — `authenticated` held a full table-wide `update` on `workspaces` via the same un-revoked Supabase default, letting a real tenant admin self-edit `access_state`/`contract_end_date`/`exclusivity_hard_block`/`rollback_window_hours` directly, bypassing the operator/Edge-Function/system-only controls this doc always claimed governed them. Deferred at Finding 7's original fix time (lower severity, scoped out at the user's explicit direction), independently re-confirmed by a second review pass later the same day, then fixed and live-reverified in a third pass via `20260810180000_workspaces_grant_lockdown.sql` (`revoke all` + `select`-only re-grant — stronger than the `profiles` fix, since no legitimate feature updates `workspaces` via `authenticated` at all). Full narrative in `docs/security-review-2026-07-29.md` Finding 7. Correction to previously-inaccurate documentation, not a new schema change, hence a minor bump per STD-002. |
| 2.8.0 | 2026-08-10 | `profiles.position` becomes self-editable (`tb-user-profile-position-self-edit-001`), reversing part of `tb-employee-position-001`'s access model (v2.6.0) at the user's request — position has no access-level implications the way role/tenant_id do, so gating it admin-only was over-scoped. `grant update (position) on public.profiles to authenticated` added via `20260810190000_profiles_position_self_edit.sql`, additive on top of the `20260810170000` lockdown (role/tenant_id remain ungranted). The existing admin-only Team-page route is unchanged; both paths now write the same column, last write wins. Live-reverified (self-edit succeeds, role/tenant_id still rejected) and browser-verified (edit, save, reload, persisted). Structural (grant change on an existing column, not a new one), hence a minor version bump per STD-002. |
| 2.9.0 | 2026-08-10 | **Correction** (`tb-platform-grant-lockdown-001`, Finding 8). Two gaps neither v2.5.0 nor v2.7.0 closed: (1) `anon` held the identical un-revoked default grant on `profiles`/`workspaces` that `authenticated` did — both fixes only ever ran `revoke ... from authenticated`. Not exploitable (every RLS policy here keys off `auth.uid()`, `NULL` pre-auth), but the same latent risk. Closed via `20260810220000_profiles_workspaces_anon_lockdown.sql`. (2) `contract_notifications`' "no grants to anon/authenticated" claim wasn't actually true either — same pattern, closed via `20260810210000_tier3_zero_policy_grant_lockdown.sql`. Correction to previously-inaccurate documentation, not a schema change, hence a minor bump per STD-002. |
