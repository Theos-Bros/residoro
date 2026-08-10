# DD-014 — Commission: Structure & Computed Earnings

**Status:** Draft
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-08-04
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `public.workspace_commission_settings` and
`public.commission_earnings`, as implemented by `tb-commission-structure-001`
(`supabase/migrations/20260804140000_commission_structure.sql`). Written at implementation time,
per RFC-004's documentation cadence requirement.

---

## Scope

Covers `workspace_commission_settings` and `commission_earnings` only — `cap-commission-001`'s
sole tracer bullet. Does not cover `closings` (DD-013), `contracts` (DD-012), or `offers`
(DD-011). Does not cover payout/disbursement or tax/accounting reporting — computed earnings
tracking only, per the parent capability's own scope.

---

## Table: `workspace_commission_settings`

Singleton per-tenant row (same shape as `workspace_matching_settings`/
`workspace_performance_settings`), holding the workspace's default commission split. Seeded
automatically for every tenant via `provision_workspace_settings_defaults()`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tenant_id` | `uuid` | PK, FK → `workspaces(id)` | |
| `default_brokerage_pct` | `numeric` | not null, default `50` | |
| `default_agent_pct` | `numeric` | not null, default `50` | |
| `default_co_broker_pct` | `numeric` | not null, default `0` | Only meaningful when a deal involved a docket-shared listing — no automatic detection built (see Server-Side Behavior) |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

**Constraint:** `workspace_commission_settings_pct_sum_100` — `check (default_brokerage_pct +
default_agent_pct + default_co_broker_pct = 100)`. DB-level enforcement of the "these are shares
of one whole" invariant, same reasoning `tb-brokerage-permissions-admin-uniqueness-001` gave for
moving an app-only invariant to a real constraint. Also re-checked in the `PATCH /settings/
commission` route before the update is attempted, for a clean 400 rather than a raw constraint
violation.

---

## Table: `commission_earnings`

A snapshotted, immutable-once-created record — one per `closings` row (no unique constraint on
`closing_id` at the DB level; enforced by an app-level pre-check in `POST /commission-earnings`
before insert, see Server-Side Behavior). `total_commission` is manually entered per deal;
`brokerage_pct`/`agent_pct`/`co_broker_pct` are copied from whatever `workspace_commission_
settings` holds at the moment of entry.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `closing_id` | `uuid` | not null, FK → `closings(id)`, unique index | One earnings row per closing |
| `total_commission` | `numeric` | not null | Manually entered — see Server-Side Behavior for why |
| `currency` | `text` | not null, default `'PHP'` | Defaults to the closing's own `currency` |
| `brokerage_pct` / `agent_pct` / `co_broker_pct` | `numeric` | not null | Snapshotted from `workspace_commission_settings` at entry time |
| `brokerage_amount` / `agent_amount` / `co_broker_amount` | `numeric` | not null | `total_commission * pct / 100`, computed server-side |
| `computed_at` | `timestamptz` | not null, default `now()` | |
| `created_by` | `uuid` | FK → `auth.users(id)` | |

Indexes: `idx_commission_earnings_closing_id` (**unique**) on `(closing_id)`,
`idx_commission_earnings_tenant_id` on `(tenant_id)`.

---

## Row-Level Security

Two different postures, matching the distinction this codebase already draws between a Settings
sub-panel and a transactional record:

**`workspace_commission_settings`** — view-all/edit-gated, same shape as `workspace_matching_
settings`. Reuses the existing settings-delegation mechanism (`has_settings_delegation`) rather
than a hand-rolled admin check — `'commission'` is a new `setting_key`, added to
`settings_edit_delegations`' check constraint alongside `sharing_templates`/`performance`/
`matching`/`tasks`.

| Policy | Rule |
|---|---|
| `workspace_commission_settings_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `workspace_commission_settings_update_delegated` | `update` where/with check `tenant_id = current_tenant_id() and has_settings_delegation('commission')` |

`authenticated` granted `select, update` only (no insert/delete — rows are provisioned solely by
the `workspaces` insert trigger). `service_role` has full access.

**`commission_earnings`** — full tenant-scoped CRUD, open to any tenant member, same shape as
`offers`/`contracts`/`closings`. Confirmed with the user: recording an earnings entry is a
transactional action (like recording an offer or completing a closing), not a Settings edit —
only the *default split* is admin/delegation-gated, not the act of entering a specific deal's
total commission.

| Policy | Rule |
|---|---|
| `commission_earnings_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `commission_earnings_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `commission_earnings_update_tenant` | `update` where/with check `tenant_id = current_tenant_id()` |
| `commission_earnings_delete_tenant` | `delete` where `tenant_id = current_tenant_id()` |

`authenticated` granted `select, insert, update, delete` (boilerplate parity with offers/
contracts/closings; no `PATCH`/`DELETE` route is actually exposed in v1 — see Server-Side
Behavior). `service_role` has full access.

**Correction (2026-08-10):** the paragraph above rationalized a real vulnerability as
"boilerplate parity." `authenticated` holding a genuine table-wide UPDATE/DELETE grant, with
`commission_earnings_update_tenant`'s RLS check only verifying `tenant_id` (no column
restriction), meant any tenant member could directly `PATCH` `total_commission`/`agent_amount`/
`brokerage_amount`/etc. on *any* closing in their tenant via a raw PostgREST call — completely
bypassing the "no PATCH/DELETE route exists" protection this doc relied on, since that protection
only ever existed at the backend-API layer, never at the DB layer the backend itself depends on.
Same root cause as DD-001's Finding 7 (`profiles`/`workspaces`), found in the same 2026-08-10
follow-up security pass ("run a security check for anything we haven't covered") that generalized
Finding 7's fix beyond the two tables it originally covered. Fixed same day via
`supabase/migrations/20260810200000_financial_audit_grant_lockdown.sql` (`revoke all` then
`grant select` + `insert` on exactly the columns `routes/commission.ts`'s `.insert()` call uses —
no update, no delete, matching the "no legitimate write route" reality this table always had).
Live-verified via `scripts/verify-financial-audit-grant-lockdown.ts` (7/7 checks pass): UPDATE and
DELETE are now rejected with `42501: permission denied`, the legitimate insert path is unaffected.

---

## Server-Side Behavior Beyond the Schema

**Total commission is manually entered per deal, not derived from `closings.final_price`.**
Confirmed with the user, resolving the tracer bullet's own flagged open question: real commission
negotiations sometimes settle on a flat fee rather than a price-derived percentage, so a
price-based auto-computation would be wrong often enough to not be trustworthy as the only path.
`POST /commission-earnings` requires `closing_id` (must reference a `closings` row with
`completed_at` already set — commission can't be recorded against a deal that hasn't closed) and
`total_commission`; `brokerage_pct`/`agent_pct`/`co_broker_pct` are read from `workspace_
commission_settings` at that exact moment and snapshotted onto the new row, never re-read later.

**No automatic co-broker detection.** `default_co_broker_pct` is a single workspace-wide value
applied uniformly to every earnings entry — there's no check against `listing_dockets` to zero it
out for a deal that didn't actually involve a co-broker. A workspace that only occasionally has
co-broker deals has no way to distinguish per-deal in v1; the practical mitigation is
`default_co_broker_pct = 0` for any workspace where it isn't the norm. Flagged as a known
limitation, not solved here — out of the two open questions the tracer bullet's own doc named as
blocking, and not reopened as a third.

**Immutability, verified directly.** Once `commission_earnings` has a row for a given
`closing_id`, `POST /commission-earnings` rejects a second attempt with a 400 (checked before
insert, since the unique index alone would surface as a raw DB error). No `PATCH`/`DELETE` route
is exposed — a computed earnings row is a permanent record once created, matching the DoD
requirement that a later settings change never alters it. This was live-verified, not just
assumed from the schema: an earnings row was recorded at `brokerage_pct=40/agent_pct=55/
co_broker_pct=5`, the workspace's default was then changed to `50/50/0` and saved, and the
already-computed row was confirmed unchanged via direct query afterward.

**Everyone can view.** `GET /closings/:id/commission-earnings` has no role check beyond tenant
membership — confirmed with the user, matching this codebase's dominant precedent (Offers,
Contracts, Closings, Buyer Leads, Tasks — none of these gate viewing by role) over treating
commission data as admin-only.

---

## Related Documents

- `cap-commission-001` (Theos Registry) — parent capability
- `tb-commission-structure-001` (Theos Registry) — the tracer bullet this DD documents
- `tb-transactions-closing-001` / DD-013 — hard blocker; owns the completion event this tracer
  bullet computes from
- `cap-brokerage-permissions-001` / `tb-brokerage-permissions-delegation-001` — owns the
  `has_settings_delegation`/`settings_edit_delegations` mechanism reused here for the
  `'commission'` setting key
- DD-011 (Offers) — precedent for the RLS/route-gating split between a Settings sub-panel and a
  transactional record
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260804140000_commission_structure.sql`

---

## Revision History

| Version | Date | Description |
|---------|------|--------------|
| 1.0.0 | 2026-08-04 | Initial version, written alongside implementation per RFC-004. |
| 1.1.0 | 2026-08-10 | **Correction, critical.** The "boilerplate parity" UPDATE/DELETE grant rationale in Row-Level Security was a live privilege-escalation/financial-fraud vector (any tenant member could PATCH commission amounts on any closing via direct PostgREST). Fixed via `20260810200000_financial_audit_grant_lockdown.sql`, live-verified 7/7. Correction to previously-inaccurate risk assessment, not a new schema change, hence a minor bump per STD-002. |
