# DD-007 — Developers & Projects

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Exact table/column/constraint definitions for `developers`, `projects`, and
`project_unit_types` — the developer/pre-selling inventory hierarchy `properties.project_id` and
`properties.unit_type_id` point at (DD-002). Written retroactively as part of a 2026-07-27
birds-eye review.

---

## Scope

Covers `public.developers`, `public.projects`, and `public.project_unit_types`. Does not cover
`properties` (DD-002) itself.

---

## Table: `developers`

Minimal placeholder owner entity (`cap-properties-001` Decision #2) — just enough to unblock
`projects.developer_id` and, later, `properties.owner_id`. Explicitly intended to be superseded
by a real CRM Company record once that domain exists; live-verification ahead of
`tb-properties-project-001` (2026-07-27) found this table didn't exist despite
`cap-properties-001`'s Technical Architecture describing one — it was a proposed model, never
shipped, until this migration created it alongside `projects`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `name` | `text` | not null | |
| `contact_info` | `jsonb` | nullable | Unstructured — no defined shape yet |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Index: `idx_developers_tenant_id` on `(tenant_id)`.

## Table: `projects`

Developer inventory container (`cap-properties-001` Milestone 2).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `developer_id` | `uuid` | not null, FK → `developers(id)` | |
| `name` | `text` | not null | |
| `project_type` | `text` | not null, `CHECK` in (`condo`, `subdivision`, `township`, `mixed_use`) | |
| `location` | `text` | nullable | |
| `total_units` | `integer` | nullable | |
| `status` | `text` | not null, default `'pre_selling'`, `CHECK` in (`pre_selling`, `under_construction`, `ready_for_occupancy`, `sold_out`) | |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Indexes: `idx_projects_tenant_id` on `(tenant_id)`, `idx_projects_developer_id` on `(developer_id)`.

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

All three tables: standard tenant-scoped CRUD, matching `properties`'s pattern (DD-002)
exactly, including the `_delete_admin` restriction pattern for `developers` and `projects`.
`project_unit_types` has the same four policies (`select`/`insert`/`update`/`delete_admin`)
even though only create+read routes currently exist (see note above).

| Table | Policy | Rule |
|---|---|---|
| `developers` | `developers_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `developers` | `developers_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `developers` | `developers_update_tenant` | `update` where/with check `tenant_id = current_tenant_id()` |
| `developers` | `developers_delete_admin` | `delete` where `tenant_id = current_tenant_id()` and `current_role() = 'admin'` |
| `projects` | (same four, `projects_*`) | Same rules |
| `project_unit_types` | (same four, `project_unit_types_*`) | Same rules |

`authenticated` granted `select, insert, update, delete` on all three. `service_role` has full
access — as with every other table, the backend currently uses `service_role` for all routes on
all three (see ADR-002's "Superseded By (partial)" note and ADR-003).

---

## Related Documents

- DD-002 — Properties (`project_id`/`unit_type_id` FK sources; shares `property_type` value set)
- `cap-properties-001` (Theos Registry) — Project/Developer/ProjectUnitType design rationale
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260727120000_properties_projects.sql` — `developers`, `projects`, `properties.project_id` FK
- `supabase/migrations/20260727130000_project_unit_types.sql` — `project_unit_types`, `properties.unit_type_id`

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering three already-shipped tracer bullets. |
