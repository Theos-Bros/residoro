# DD-018 — Buyer Leads: Inquiries, Leads & Match History

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-08-09
**Last Updated:** 2026-08-09

---

## Purpose

Exact table/column/constraint definitions for the six tables backing `cap-buyer-leads-001`:
`inquiries`, `buyer_requirements`, `buyer_requirement_matches`, `buyer_requirement_activity_log`,
`buyer_requirement_match_logs`, and `buyer_requirement_match_log_items`. Written retroactively —
this entire domain (five migrations, 2026-07-28 through 2026-08-06) shipped with zero DD
coverage, caught by a 2026-08-09 birds-eye audit. Consolidated into one doc rather than six,
since all six tables are read/written almost exclusively together and none is independently
meaningful without the others (see RFC-004 on the per-tracer-bullet DoD requirement meant to
prevent this gap recurring).

---

## Scope

Covers the six tables named above. Does not cover `workspace_matching_settings` or
`settings_edit_delegations` (DD-020), `contacts` (DD-005, the FK target for a Lead's identity),
or `listings`/`properties` (DD-006/DD-002, the FK targets a match/option can point at).

---

## Table: `inquiries`

Pre-qualification pen — screens prospects before they become a real Lead.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `stage` | `text` | not null, default `'to_probe'`, `CHECK` in (`to_probe`, `probing`, `not_qualified`, `qualified`) | `qualified` is reachable only through the dedicated Qualify action, never a raw `PATCH` |
| `probed_by` | `uuid` | nullable, FK → `profiles(id)` | Auto-set to the caller on the first transition to `probing` |
| `source` | `text` | nullable | Free text (e.g. `facebook_group`, `referral`) |
| `buyer_name` / `buyer_phone` / `buyer_email` / `buyer_address` | `text` | all nullable | Raw contact info captured at intake — deliberately NOT a `contacts` FK; many inquiries never become real contacts. Carried into a real `contacts` row only at Qualify time (`tb-buyer-leads-inquiry-contact-carryover-001`, 2026-08-09) |
| `intent` | `text` | nullable, `CHECK` in (`buy`, `lease`) | Nullable here (unlike `buyer_requirements.intent`) — a caller may not have captured it yet at intake |
| `property_type` | `text` | nullable, `CHECK` in 8 PH property types | Same value set as `properties.type` (DD-002) |
| `budget_min` / `budget_max` | `numeric(14,2)` | nullable | |
| `budget_currency` | `text` | not null, default `'PHP'` | |
| `target_city` / `target_province` | `text` | nullable | |
| `floor_area_sqm_min` / `lot_area_sqm_min` | `numeric(10,2)` | nullable | |
| `storeys` / `bedrooms` / `bathrooms` | `smallint` | nullable | `storeys` captured, not scored, by the matching engine |
| `household_adults` / `household_kids` / `household_pets` | `smallint` | nullable | |
| `notes` | `text` | nullable | |
| `last_searched_at` | `timestamptz` | nullable | Added by `tb-buyer-leads-matching-001` (2026-07-28) — set by the search endpoint; symmetric with `buyer_requirements.last_searched_at` |
| `promoted_lead_id` | `uuid` | nullable, FK → `buyer_requirements(id)` | Set at Qualify time |
| `archived_at` | `timestamptz` | nullable | Manual archive only — no scheduled auto-purge |
| `search_vector` | `tsvector` | generated always as, stored | Added by `tb-search-core-entities-001`'s follow-up correction (`20260808150000_search_leads.sql`, 2026-08-08) — `to_tsvector(buyer_name)` only, the sole identifying text field on the row itself |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` / `updated_at` | `timestamptz` | not null, default `now()` | `updated_at` trigger-maintained |

Indexes: `idx_inquiries_tenant_id`, `idx_inquiries_tenant_stage` on `(tenant_id, stage)`,
`idx_inquiries_search_vector` (GIN).

---

## Table: `buyer_requirements` (the real pipeline — "Leads")

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `contact_id` | `uuid` | **not null**, FK → `contacts(id)` | Display name always derives from here — deliberately no separate `buyer_name` field (avoids a second name field that could drift out of sync) |
| `source_inquiry_id` | `uuid` | nullable, FK → `inquiries(id)` | A Lead can be created directly, not only via Qualify |
| `stage` | `text` | not null, default `'registered'`, `CHECK` in (`registered`, `searching`, `stalled`, `options_sent`, `viewing`, `negotiating`, `contract_closing`, `won`, `lost`) | Only the first four are automated by `cap-buyer-leads-001` itself; the rest are manual labels pending a showing/offer/contract feature |
| `intent` | `text` | **not null**, default `'buy'`, `CHECK` in (`buy`, `lease`) | Unlike `inquiries.intent`, not nullable — an inquiry's null `intent` falls back to `'buy'` at Qualify time |
| `property_type` / `budget_min` / `budget_max` / `budget_currency` / `target_city` / `target_province` / `floor_area_sqm_min` / `lot_area_sqm_min` / `storeys` / `bedrooms` / `bathrooms` / `household_adults` / `household_kids` / `household_pets` / `notes` | — | — | Same shape as `inquiries`' equivalent columns — both tables deliberately share the same requirement-field shape so the matching engine can run against either |
| `last_searched_at` | `timestamptz` | nullable | Set by the search endpoint; a `registered`/`stalled` Lead auto-advances to `searching` when this updates |
| `won_listing_id` | `uuid` | nullable, FK → `listings(id)` | Bookkeeping-only link at the Won transition — never a second write path into `listings.buyer_contact_id` (that contract stays owned entirely by `tb-crm-buyer-001`) |
| `lease_end_date` | `date` | nullable | Added by `tb-buyer-leads-revisit-page-001` (2026-07-30). Captured (and required) on `PATCH /buyer-requirements/:id/mark-won` when `won_listing_id` resolves to a lease-type listing; left null for sale-type wins. Powers the Revisit page's lease-renewal follow-up. Entered directly by the agent, never auto-calculated — **not** the same concept as `workspace.contract_end_date` (Residoro's own SaaS contract) or `properties.status = 'leased'` (`tb-properties-unit-leasing-001`'s unrelated developer-inventory concept) |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` / `updated_at` | `timestamptz` | not null, default `now()` | `updated_at` trigger-maintained |

Indexes: `idx_buyer_requirements_tenant_id`, `idx_buyer_requirements_tenant_stage` on
`(tenant_id, stage)`, `idx_buyer_requirements_contact_id`.

---

## Table: `buyer_requirement_matches`

The **options-sent stage-transition record** — one row per listing actually sent as an option to
a Lead. Distinct from the match-log tables below (informational history, no stage-transition
meaning).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `buyer_requirement_id` | `uuid` | not null, FK → `buyer_requirements(id)`, `on delete cascade` | |
| `listing_id` | `uuid` | **not null**, FK → `listings(id)` | No `property_id` alternative — cannot represent a project-unit-only match (see match-log tables below, which exist partly because of this constraint) |
| `score` | `numeric(5,2)` | nullable | Null until the ranked Search page sends an explicit score; the plain unranked picker (`LeadDetailPanel`) still always stores null. Schema-present since `tb-buyer-leads-schema-001` but not actually persisted by any caller until a 2026-07-28 fix closed that gap |
| `sent_at` | `timestamptz` | not null, default `now()` | |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | |

**Constraint:** `unique (buyer_requirement_id, listing_id)` — a given listing can only be
recorded as sent to a given Lead once.

Indexes: `idx_brm_tenant_id`, `idx_brm_buyer_requirement_id`.

---

## Table: `buyer_requirement_activity_log`

Manually-logged running history (call/email/meeting/note) — general-purpose, append-only.
"Last contact" is derived client/query-side as `max(occurred_at)`, not a stored column.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)`, `on delete cascade` | |
| `buyer_requirement_id` | `uuid` | not null, FK → `buyer_requirements(id)`, `on delete cascade` | |
| `activity_type` | `text` | not null, `CHECK` in (`call`, `email`, `meeting`, `note`, `other`) | |
| `notes` | `text` | nullable | |
| `occurred_at` | `timestamptz` | not null, default `now()` | |
| `logged_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | No `updated_at` — append-only, a wrong entry gets a corrective follow-up entry, not an edit |

Indexes: `idx_bral_tenant_id`, `idx_bral_buyer_requirement_id_occurred_at` on
`(buyer_requirement_id, occurred_at desc)`.

---

## Tables: `buyer_requirement_match_logs` + `buyer_requirement_match_log_items`

A separate, deliberately parallel concept from `buyer_requirement_matches` above — many-per-lead,
purely informational, never a precondition or substitute for anything. One "Log match" UI action
= one `match_logs` row (the event: who, when) + N `match_log_items` rows (what was matched).
Exists as its own table pair specifically because `buyer_requirement_matches`' `NOT NULL
listing_id` can't represent a project-unit-only match with no `Listing` yet.

**`buyer_requirement_match_logs`:**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)`, `on delete cascade` | |
| `buyer_requirement_id` | `uuid` | not null, FK → `buyer_requirements(id)`, `on delete cascade` | |
| `logged_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | No `updated_at` — immutable, append-only history |

**`buyer_requirement_match_log_items`:**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `match_log_id` | `uuid` | not null, FK → `buyer_requirement_match_logs(id)`, `on delete cascade` | No own `tenant_id` — never queried directly by tenant, only through its parent |
| `listing_id` | `uuid` | nullable, FK → `listings(id)` | |
| `property_id` | `uuid` | nullable, FK → `properties(id)` | Covers project-linked units with no Listing yet (`tb-buyer-leads-matching-project-units-001`) |

**Constraint:** `match_log_item_has_one_target` — `check ((listing_id is not null) <>
(property_id is not null))`, exactly one of the two per row.

Indexes: `idx_brml_tenant_id`, `idx_brml_buyer_requirement_id`, `idx_brmli_match_log_id`,
`idx_brmli_listing_id`, `idx_brmli_property_id`.

---

## Row-Level Security

All six tables: standard tenant-scoped pattern, whole-brokerage visible (no agent-assignment
concept anywhere in `cap-buyer-leads-001`, so no per-agent restriction on any of them).

| Table | Select/Insert/Update | Delete |
|---|---|---|
| `inquiries`, `buyer_requirements` | Tenant-scoped, all three ops | Admin-only |
| `buyer_requirement_matches` | Tenant-scoped select/insert | Tenant-scoped (any member, not admin-only) |
| `buyer_requirement_activity_log`, `buyer_requirement_match_logs` | Tenant-scoped select/insert only | None — immutable/append-only, deletable only via cascade from a deleted parent |
| `buyer_requirement_match_log_items` | Via `EXISTS` join to parent `match_logs` row's tenant check (no own `tenant_id`) | None |

`authenticated` granted per the table above; `service_role` full access on all six.
`buyer_requirement_match_logs`/`_match_log_items`'s policies use the perf-aligned `(select
current_tenant_id())` wrapper from the start (established by `20260728190000`, the RLS-perf-align
migration that retrofitted the two 2026-07-28 tables to match); every other table in this doc
also carries that wrapper as of `tb-platform-performance-hardening-001` (2026-07-28).

---

## Related Documents

- `cap-buyer-leads-001` (Theos Registry) — full business-entity design rationale, all decisions
  and tracer-bullet history
- DD-005 — Contacts (`buyer_requirements.contact_id`'s FK target, the identity source for a
  Lead's display name)
- DD-006 — Listings & Docket Sharing (`won_listing_id`, `buyer_requirement_matches.listing_id`,
  `match_log_items.listing_id` FK targets)
- DD-002 — Properties (`match_log_items.property_id` FK target)
- DD-020 — Settings Delegations (`workspace_matching_settings`, `settings_edit_delegations` —
  the matching-engine config this domain's search endpoints read)
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- `supabase/migrations/20260728160000_buyer_leads_schema.sql` — `inquiries`, `buyer_requirements`,
  `buyer_requirement_matches`
- `supabase/migrations/20260728170000_buyer_leads_matching.sql` — `inquiries.last_searched_at`
- `supabase/migrations/20260728190000_buyer_leads_rls_perf_align.sql` — RLS perf-wrapper alignment
- `supabase/migrations/20260730100000_buyer_leads_lease_end_date.sql` — `lease_end_date`
- `supabase/migrations/20260806120000_buyer_leads_match_logs.sql` — `buyer_requirement_match_logs`,
  `_match_log_items`
- `supabase/migrations/20260807130000_buyer_leads_activity_log.sql` — `buyer_requirement_activity_log`
- `supabase/migrations/20260808150000_search_leads.sql` — `inquiries.search_vector`

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-08-09 | Initial version, written retroactively from a 2026-08-09 birds-eye audit — this entire six-table domain had zero DD coverage across five migrations since 2026-07-28. |
