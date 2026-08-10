# DD-007 — Developers & Projects

**Status:** Draft
**Version:** 2.2.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `projects` and `project_unit_types` — the
pre-selling inventory hierarchy `properties.project_id` and `properties.unit_type_id` point at
(DD-002) — plus the retired `developers` table's history. Written retroactively as part of a
2026-07-27 birds-eye review; the `developers` section rewritten 2026-08-03 after its consolidation
into `contacts`.

---

## Scope

Covers `public.projects` and `public.project_unit_types`, plus the history of the now-dropped
`public.developers` table. Does not cover `properties` (DD-002) or `contacts` (DD-005) itself.

---

## Table: `developers` — DROPPED 2026-07-28, folded into `contacts`

Originally a minimal placeholder owner entity (`cap-properties-001` Decision #2) — just enough
to unblock `projects.developer_id` and, later, `properties.owner_id`. This DD's own 1.0.0
revision (2026-07-27) already flagged it as "explicitly intended to be superseded by a real CRM
Company record once that domain exists" — that happened the very next day.
`tb-crm-developer-consolidation-001` (`cap-crm-001` Milestone 1, `supabase/migrations/
20260728140000_crm_developer_consolidation.sql`) dropped this table entirely:

1. Added `contacts.is_company boolean not null default false` (see DD-005) — `cap-crm-001`'s
   Company concept.
2. Copied every `developers` row into `contacts` with the **same `id`** (so
   `projects.developer_id` values didn't need updating, only the FK's target table), `type =
   'developer'`, `is_company = true`.
3. Repointed `projects.developer_id`'s FK from `developers(id)` to `contacts(id)`.
4. `drop table public.developers`.

`contact_info jsonb`'s unstructured shape was **not** decomposed into `contacts`' discrete
columns as part of this migration — confirmed live on 2026-07-28 that every existing
`developers` row (zero, at the time) had no such data to lose. A future consolidation of this
kind against a database with real `contact_info` data would need that decomposition done
explicitly first; it wasn't a gap here, just not a generally-reusable migration.

The original column table (`id`, `tenant_id`, `name`, `contact_info jsonb`, `created_by`,
timestamps) and its RLS policies (`developers_select_tenant`/`_insert_tenant`/`_update_tenant`/
`_delete_admin`, all `current_tenant_id()`-scoped) no longer exist and are omitted here — see
this document's git history before 2026-08-03 if the exact pre-drop shape is ever needed.

## Table: `projects`

Developer inventory container (`cap-properties-001` Milestone 2).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `developer_id` | `uuid` | not null, FK → `contacts(id)` (repointed 2026-07-28, was `developers(id)`) | Points at a `contacts` row with `is_company = true`, `type = 'developer'` — see the dropped `developers` table's history above |
| `name` | `text` | not null | |
| `project_type` | `text` | not null, `CHECK` in (`condo`, `subdivision`, `township`, `mixed_use`) | |
| `location` | `text` | nullable | |
| `total_units` | `integer` | nullable | |
| `status` | `text` | not null, default `'pre_selling'`, `CHECK` in (`pre_selling`, `under_construction`, `ready_for_occupancy`, `sold_out`) | |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |
| `search_vector` | `tsvector` | generated always as, stored | Added by `tb-search-core-entities-001` (2026-08-08). `setweight(name, 'A') \|\| setweight(location, 'B')`. Feeds `search_global()`'s `project` result type |

Indexes: `idx_projects_tenant_id` on `(tenant_id)`, `idx_projects_developer_id` on `(developer_id)`,
`idx_projects_search_vector` (GIN, added by the same migration as the column).

Bulk unit generation and rollup views were deliberately out of `tb-properties-project-001`'s
scope — this table and the `properties.project_id` FK are the entity/link only. See
`tb-properties-bulk-units-001` and `tb-properties-project-rollup-001` for what was built on top.

## Table: `project_unit_types`

Named unit-type templates within a project (e.g. "1BR", "2BR", "Penthouse"), each with their own
size/amenities/price — resolves the unit-type/floor-plan variation question
`tb-properties-project-001` deliberately left open. Bulk unit generation
(`POST /projects/:id/unit-types/:unitTypeId/generate-units`) stamps these templates out as
ordinary `properties` rows.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `project_id` | `uuid` | not null, FK → `projects(id)` | |
| `name` | `text` | not null | |
| `property_type` | `text` | not null, `CHECK` in 8 PH property types | Same value set as `properties.type` (DD-002) |
| `floor_area_sqm` | `numeric(10,2)` | nullable | |
| `lot_area_sqm` | `numeric(10,2)` | nullable | |
| `bedrooms` | `smallint` | nullable | |
| `bathrooms` | `smallint` | nullable | |
| `parking_slots` | `smallint` | nullable | |
| `price` | `numeric(14,2)` | nullable | |
| `price_currency` | `text` | not null, default `'PHP'` | |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Indexes: `idx_project_unit_types_tenant_id` on `(tenant_id)`, `idx_project_unit_types_project_id`
on `(project_id)`.

**Create-only in v1**: no update route is exposed (`tb-properties-bulk-units-001` semantic_scope
— a wrong template is fixed by creating a new one). The `update` RLS policy exists ahead of the
route anyway, matching `properties`'/`projects`' own precedent of RLS existing before any route
that could use it.

---

## Row-Level Security

Both remaining tables: standard tenant-scoped CRUD, matching `properties`'s pattern (DD-002)
exactly, including the `_delete_admin` restriction pattern for `projects`. `project_unit_types`
has the same four policies (`select`/`insert`/`update`/`delete_admin`) even though only
create+read routes currently exist (see note above). (`developers` had the same four-policy
shape before it was dropped 2026-07-28 — see above.)

| Table | Policy | Rule |
|---|---|---|
| `projects` | `projects_select_tenant` / `_insert_tenant` / `_update_tenant` / `_delete_admin` | Standard `current_tenant_id()` rules, matching `properties` |
| `project_unit_types` | (same four, `project_unit_types_*`) | Same rules |

`authenticated` granted `select, insert, update, delete` on both remaining tables. `service_role`
has full access. **Update, 2026-07-28 (`tb-platform-rls-scoped-client-001`, per ADR-003):**
`projects.ts` now uses the per-request scoped client for `projects`/`project_unit_types` data
calls — RLS is the real enforcement boundary here, not `service_role`.

**Correction (2026-08-10, `tb-platform-grant-lockdown-001`):** the claimed verb set was wrong for
both tables, not just table-wide — `projects` has no route that ever deletes a row (`delete`
removed), and `project_unit_types` has no route that ever updates or deletes one (only `insert`
kept; unit types are created once from the project-generation flow and never edited/removed
directly). `anon` held the identical un-revoked default on both. Closed via `supabase/migrations/
20260810240000_tier1_grant_lockdown.sql`. Live-verified end-to-end
(`verify-buyer-leads-matching-project-units.ts`, `verify-tier1-escalation-checks.ts`).

---

## Related Documents

- DD-002 — Properties (`project_id`/`unit_type_id` FK sources; shares `property_type` value set)
- DD-005 — Contacts (`is_company`, the table `developers` was folded into)
- `cap-properties-001` (Theos Registry) — original Project/Developer/ProjectUnitType design rationale
- `cap-crm-001` (Theos Registry) — Milestone 1, the developer-consolidation decision
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260727120000_properties_projects.sql` — original `developers`, `projects`, `properties.project_id` FK
- `supabase/migrations/20260727130000_project_unit_types.sql` — `project_unit_types`, `properties.unit_type_id`
- `supabase/migrations/20260728140000_crm_developer_consolidation.sql` — dropped `developers`, folded into `contacts`
- `supabase/migrations/20260808140000_search_core_entities.sql` — `projects.search_vector` added

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering three already-shipped tracer bullets. |
| 2.0.0 | 2026-08-03 | `developers` table dropped and folded into `contacts` the day after this doc's initial version was written (`tb-crm-developer-consolidation-001`, 2026-07-28) — this doc had described a table that no longer existed for six days. Rewrote the `developers` section as a historical record, repointed `projects.developer_id`'s documented FK target to `contacts(id)`, corrected the stale `service_role`-for-all-routes RLS claim. Structural revision (table removal), hence major version bump per STD-002. |
| 2.1.0 | 2026-08-09 | Added `projects.search_vector` (`tb-search-core-entities-001`, 2026-08-08 — missed at ship time, caught by the same-day birds-eye audit that also caught DD-002/DD-005's identical gap). |
| 2.2.0 | 2026-08-10 | **Correction.** The `select, insert, update, delete` grant claim was wrong for both tables — `projects` has no delete route, `project_unit_types` has neither an update nor a delete route; `anon` held the identical default too. Closed via `20260810240000_tier1_grant_lockdown.sql` (`tb-platform-grant-lockdown-001`). Correction to previously-inaccurate documentation, hence a minor bump per STD-002. |
