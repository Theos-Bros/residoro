# DD-019 — Listing Share Events

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-08-09
**Last Updated:** 2026-08-09

---

## Purpose

Exact table/column/constraint definitions for `listing_share_events`, as implemented by
`supabase/migrations/20260728100000_analytics_share_performance.sql`
(`tb-analytics-share-performance-001`). Written retroactively — this table shipped with zero DD
coverage, caught by a 2026-08-09 birds-eye audit.

---

## Scope

Covers only `public.listing_share_events`. The per-workspace `hot_share_threshold` setting this
table's row count is compared against briefly lived on `workspaces`, then moved the same day
into `workspace_performance_settings` — see DD-020.

---

## Table: `listing_share_events`

Best-effort usage telemetry — one row per successful clipboard copy from `ShareDetailsModal`
(`cap-distribution-001`). **Not** a tamper-proof audit trail: client-triggered, fires only after
a successful clipboard copy — a manual select+copy of the rendered text bypasses this entirely.
This limitation was confirmed and knowingly accepted (`cap-analytics-001`'s `semantic_scope`),
not an oversight.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `listing_id` | `uuid` | not null, FK → `listings(id)`, `on delete cascade` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `audience` | `text` | not null, `CHECK` in (`public`, `co_broker`, `internal`) | Mirrors `cap-distribution-001`'s three sharing tiers |
| `shared_by` | `uuid` | not null, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | No `updated_at` — an event row is never edited, only inserted |

Indexes: `idx_listing_share_events_listing_id` on `(listing_id)`,
`idx_listing_share_events_tenant_created` on `(tenant_id, created_at)`.

No delete or update path exists — this is an append-only event log by design (matches
`cap-analytics-001`'s explicit decision not to build event revocation: text already pasted
outside Residoro can't be recalled, so revoking the log entry wouldn't undo anything real).

---

## Row-Level Security

Tenant-wide read/write — any authenticated tenant member can log and view their own workspace's
share events, not just admins or the original sharer (same pattern as `property_documents`/
`property_media`).

| Policy | Rule |
|---|---|
| `listing_share_events_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `listing_share_events_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |

`authenticated` granted `select, insert` only — no `update`/`delete` grant at all, matching the
append-only design above. `service_role` has full access.

---

## Related Documents

- `cap-analytics-001` (Theos Registry) — full business-entity design rationale, including why
  this is deliberately client-triggered telemetry, not an enforced/tamper-proof mechanism
- DD-020 — Settings Delegations (`workspace_performance_settings.hot_share_threshold`, the
  per-workspace setting this table's 30-day trailing count is compared against to compute the
  "Hot" flag)
- DD-006 — Listings & Docket Sharing (`listing_id` FK target)
- `cap-distribution-001` (Theos Registry) — owns `ShareDetailsModal` and the three sharing tiers
  (`public`/`co_broker`/`internal`) this table's `audience` column mirrors
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- `supabase/migrations/20260728100000_analytics_share_performance.sql` — implements this table
  (and originally `workspaces.hot_share_threshold`, moved same-day — see DD-020)

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-08-09 | Initial version, written retroactively from a 2026-08-09 birds-eye audit — this table had zero DD coverage since 2026-07-28. |
