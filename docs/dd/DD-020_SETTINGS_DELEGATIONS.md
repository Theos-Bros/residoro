# DD-020 — Settings Delegations & Per-Setting Tables

**Status:** Draft
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-08-09
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `settings_edit_delegations` and the per-setting
tables it governs delegated write access to: `workspace_sharing_settings`,
`workspace_performance_settings`, `workspace_matching_settings`, `workspace_commission_settings`,
`workspace_itinerary_settings`. Written retroactively — this domain shipped across three
migrations (2026-07-28) with zero DD coverage, caught by a 2026-08-09 birds-eye audit. See ADR-004
for the full architectural rationale (why per-setting tables, not a delegation check on the shared
`workspaces` row) — this doc covers exact schema only, not design reasoning already recorded
there.

**2026-08-10 note (per RFC-004's documentation-cadence requirement):** `tb-buyer-leads-itinerary-
settings-001` added `workspace_itinerary_settings` and widened `setting_key` to add `itinerary` —
same pattern as every prior addition to this table, documented below rather than deferred to a
later catch-up review.

---

## Scope

Covers the six tables named above. `workspace_task_routing_settings` — the same delegated-
settings pattern applied to Tasks — is documented in DD-017 alongside `tasks` itself (the two
ship and are read together); not duplicated here, only cross-referenced.

---

## The Pattern (see ADR-004 for full rationale)

A delegatable Settings sub-section gets its own single-row-per-tenant table (`tenant_id` as
PK), not a column on the shared `workspaces` row — RLS can only discriminate by row, never by
column within one row, so a shared-row delegation check would let a member delegated for ONE
setting write to ALL settings on that row. Each per-setting table's `UPDATE` policy calls the
shared `has_settings_delegation(p_setting_key)` function (`SECURITY DEFINER`, mirrors
`current_tenant_id()`'s hijacking-safe posture) instead of re-deriving the same "admin OR a
matching delegation row" check per table.

---

## Table: `settings_edit_delegations`

Per-member, per-setting edit grants. Additive on top of the `admin`/`member`/`operator` role
model — an admin's own edit rights always come from `role = 'admin'`, never from a row here.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `member_id` | `uuid` | not null, FK → `profiles(id)` | |
| `setting_key` | `text` | not null, `CHECK` in (`sharing_templates`, `performance`, `matching`, `tasks`, `commission`, `itinerary`) | Widened four times after initial ship: `matching` (`tb-buyer-leads-matching-001`, 2026-07-28), `tasks` (`tb-tasks-crud-001`, 2026-07-28), `commission` (`tb-commission-structure-001`, 2026-08-04), `itinerary` (`tb-buyer-leads-itinerary-settings-001`, 2026-08-10) — each new delegatable setting widens this list, same pattern every time |
| `granted_by` | `uuid` | not null, FK → `profiles(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |

**Constraint:** `unique (tenant_id, member_id, setting_key)` — one grant per member per setting.

Index: `idx_settings_edit_delegations_tenant_member` on `(tenant_id, member_id)`.

---

## Table: `workspace_sharing_settings`

One row per tenant. Split out of `workspaces` (the two template columns previously lived there
directly) so RLS can enforce `sharing_templates` delegation without also exposing unrelated
`workspaces` columns to a delegated non-admin.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tenant_id` | `uuid` | PK, FK → `workspaces(id)` | |
| `public_share_template` | `text` | nullable | |
| `co_broker_share_template` | `text` | nullable | |
| `buyer_wanted_share_template` | `text` | nullable | Added by `tb-buyer-leads-broadcast-001` (2026-07-28), same migration batch — a third sharing tier alongside `public`/`co_broker`, named to match this table's existing convention |

---

## Table: `workspace_performance_settings`

One row per tenant. Split out of `workspaces` the same way — `hot_share_threshold` was briefly a
plain `workspaces` column (added by `tb-analytics-share-performance-001` earlier the same day),
then moved here minutes later by this migration, in the same batch that established the
per-setting-table pattern.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tenant_id` | `uuid` | PK, FK → `workspaces(id)` | |
| `hot_share_threshold` | `integer` | not null, default `3` | Per-brokerage share-count threshold (trailing 30 days) at or above which a listing is flagged "Hot" on the Performance page — see DD-019 (`listing_share_events`, the table this count is computed from) |

---

## Table: `workspace_matching_settings`

One row per tenant. Mirrors `workspace_performance_settings`' shape exactly — built after the
per-setting-table pattern was already established, so this one never had a `workspaces`-column
phase at all.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tenant_id` | `uuid` | PK, FK → `workspaces(id)` | |
| `match_score_threshold` | `integer` | not null, default `50`, `CHECK` between 0 and 100 | The cutoff a `cap-buyer-leads-001` search result needs to clear to count as a "good match" |

---

## Table: `workspace_commission_settings`

One row per tenant. Never had a `workspaces`-column phase — built directly as its own table,
same shape as `workspace_matching_settings`. Missed by this doc's original 2026-08-09 version
despite shipping 2026-08-04; added 2026-08-10 while documenting `workspace_itinerary_settings`,
rather than left as a second known drift.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tenant_id` | `uuid` | PK, FK → `workspaces(id)` | |
| `default_brokerage_pct` | `numeric` | not null, default `50` | |
| `default_agent_pct` | `numeric` | not null, default `50` | |
| `default_co_broker_pct` | `numeric` | not null, default `0` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Bumped by `trg_workspace_commission_settings_updated_at` |

**Constraint:** `check (default_brokerage_pct + default_agent_pct + default_co_broker_pct = 100)`
— DB-level enforcement of the three-way split invariant, not trusted to application code alone.

`setting_key`: `commission` — added by `tb-commission-structure-001` (2026-08-04).

---

## Table: `workspace_itinerary_settings`

One row per tenant. Additive configuration for `tb-buyer-leads-match-itinerary-001`'s Google
Docs itinerary generation — any field left null falls back to that tracer bullet's original
behavior for that piece (plain-text builder, no folder, agent-only share).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tenant_id` | `uuid` | PK, FK → `workspaces(id)` | |
| `recipient_email` | `text` | nullable | Standing recipient, gets `writer` access on every generated itinerary in addition to the requesting agent, not instead of |
| `drive_folder_id` | `text` | nullable | Target Drive folder — must be manually shared with the service account's own email first (a real Google-side prerequisite, not automatable) |
| `template_document_id` | `text` | nullable | Google Doc copied + merge-filled (`{{title}}`, `{{buyer_name}}`, `{{items_table}}`) instead of building plain text; same manual-share prerequisite as the folder |
| `updated_at` | `timestamptz` | not null, default `now()` | Bumped by `trg_workspace_itinerary_settings_updated_at` |

`setting_key`: `itinerary` — added by `tb-buyer-leads-itinerary-settings-001` (2026-08-10).

Note: the backend accepts a full Drive/Docs URL or a bare file ID for `drive_folder_id`/
`template_document_id` — URLs are normalized to their file ID at write time
(`extractGoogleFileId()` in `application/backend/src/routes/itinerarySettings.ts`), so this
column always holds a bare ID, never a URL.

---

## Row-Level Security

**`settings_edit_delegations`:** any tenant member can `select` (needed so a delegated member's
own `GET` can compute `can_edit`); `insert`/`update`/`delete` are admin-only, mirroring
`workspaces_update_admin`'s shape.

**Every per-setting table** (`workspace_sharing_settings`, `workspace_performance_settings`,
`workspace_matching_settings`, `workspace_commission_settings`, `workspace_itinerary_settings`,
and `workspace_task_routing_settings` per DD-017): any tenant member can `select`; `update`
requires `has_settings_delegation('<setting_key>')` — true for an admin, or a member holding a
matching `settings_edit_delegations` row. No table has an `insert` or `delete` policy for
`authenticated` — rows are seeded once per tenant by the migration/tenant-creation trigger, never
created or removed by a route.

`service_role` has full access on all six tables in this doc.

---

## Related Documents

- ADR-004 — Per-Setting Tables for Delegated (Toggle-able) Permissions (the architectural
  rationale this doc's schema implements)
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes (the caller's own scoped
  client performs these writes directly — no service-role bypass anywhere in this feature)
- DD-001 — Workspaces & Profiles (the shared `workspaces` row these settings were split out of)
- DD-017 — Tasks (`workspace_task_routing_settings`, the same pattern applied to Tasks)
- DD-019 — Listing Share Events (`listing_share_events`, the table `hot_share_threshold` is
  computed against)
- `cap-brokerage-permissions-001` (Theos Registry) — full business rationale for delegated
  Settings edit access
- `theos-playbook` — `learn-delegated-permissions-rls-001` (the reusable pattern write-up this
  domain follows)
- `supabase/migrations/20260728110000_settings_edit_delegations.sql` — `settings_edit_delegations`
  (initial, select-only)
- `supabase/migrations/20260728120000_settings_delegation_rls_tables.sql` — `has_settings_delegation()`,
  `workspace_sharing_settings`, `workspace_performance_settings`, full `settings_edit_delegations`
  RLS
- `supabase/migrations/20260728170000_buyer_leads_matching.sql` — `workspace_matching_settings`,
  `setting_key` widened to add `matching`
- `supabase/migrations/20260728200000_tasks_schema.sql` — `setting_key` widened to add `tasks`
- `supabase/migrations/20260804140000_commission_structure.sql` — `workspace_commission_settings`,
  `setting_key` widened to add `commission`
- `supabase/migrations/20260810120000_itinerary_settings.sql` — `workspace_itinerary_settings`,
  `setting_key` widened to add `itinerary`
- `tb-buyer-leads-match-itinerary-001` (Theos Registry) — the itinerary generation feature
  `workspace_itinerary_settings` makes configurable

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-08-09 | Initial version, written retroactively from a 2026-08-09 birds-eye audit — this four-table domain had zero DD coverage across three migrations since 2026-07-28. |
| 1.1.0 | 2026-08-10 | Added `workspace_itinerary_settings` (`tb-buyer-leads-itinerary-settings-001`) and, catching a second pre-existing drift while here, the previously-undocumented `workspace_commission_settings` (`tb-commission-structure-001`, shipped 2026-08-04, missed by this doc's own initial 2026-08-09 version). |
