# DD-002 — Properties

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-21

---

## Purpose

Exact table/column/constraint definitions for `properties`, as implemented by
`supabase/migrations/20260721120000_platform_foundation.sql`.

---

## Scope

Covers only the `public.properties` table. Does not cover `Project`, `Developer`,
`PropertyMedia`, or `PropertyDocument` — see DS-002's Scope section for why those are deferred.

---

## Table: `properties`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `project_id` | `uuid` | nullable, **no FK** | See Deviations below |
| `type` | `text` | not null, `CHECK` in 8 PH property types | See Type Choices below |
| `owner_type` | `text` | not null, `CHECK` in (`developer`, `individual`, `company`) | |
| `owner_id` | `uuid` | not null, **no FK** | See Deviations below |
| `title` | `text` | not null | |
| `address` | `text` | nullable | |
| `city` | `text` | nullable | |
| `province` | `text` | nullable | |
| `latitude` | `numeric(9,6)` | nullable | See "coordinates" translation below |
| `longitude` | `numeric(9,6)` | nullable | |
| `floor_area_sqm` | `numeric(10,2)` | nullable | |
| `lot_area_sqm` | `numeric(10,2)` | nullable | |
| `bedrooms` | `smallint` | nullable | |
| `bathrooms` | `smallint` | nullable | |
| `parking_slots` | `smallint` | nullable | |
| `price` | `numeric(14,2)` | nullable | |
| `price_currency` | `text` | not null, default `'PHP'` | |
| `status` | `text` | not null, default `'available'`, `CHECK` in (`available`, `reserved`, `sold`, `off_market`) | |
| `verification_status` | `text` | not null, default `'unverified'`, `CHECK` in (`unverified`, `pending`, `verified`, `flagged`) | |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | Nullable: future service-role/bulk-import writes may not have a single acting user |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |

Indexes: `idx_properties_tenant_id` on `(tenant_id)`, `idx_properties_tenant_status` on
`(tenant_id, status)` — the obvious first query ("list my workspace's available properties")
is composite-indexed from the start.

---

## Deviations From `cap-properties-001`

`cap-properties-001` specifies `project_id` as an FK to `Project` and `owner_id` as a
polymorphic FK to `Developer` or a CRM Contact/Company. Neither target table exists yet (both
are later milestones). Both columns exist with the same shape they'll eventually have
(`uuid`), but with **no foreign key constraint** for now — adding the constraint later is a
non-breaking `ALTER TABLE ... ADD CONSTRAINT`, not a data migration.

`cap-properties-001` describes `coordinates` generically; this DD splits it into `latitude
numeric(9,6)` / `longitude numeric(9,6)` rather than a PostGIS `geography`/`point` type.
`numeric(9,6)` gives ~11cm precision, comfortably enough for property-level location — PostGIS
is deferred until proximity/radius search is an actual requirement (not needed for this
foundation slice).

---

## Type Choices: `CHECK` Constraints, Not Native Postgres `ENUM`

`type`, `owner_type`, `status`, and `verification_status` are all plain `text` columns with a
`CHECK (col in (...))` constraint, not native Postgres `ENUM` types. This directly follows
`cap-properties-001`'s own Key Design Decision 4: *"types are config-driven where practical;
new types are added via migration + config, not code branching."* A `CHECK` constraint is a
trivial `ALTER TABLE ... DROP CONSTRAINT` / `ADD CONSTRAINT` to add or remove an allowed value;
a native `ENUM` type's values can't be removed at all and don't introspect as cleanly for a
future config-driven admin UI. This is a deliberate DD-level implementation choice, not a
re-opening of `cap-properties-001`'s schema.

---

## Row-Level Security

RLS enabled. Uses the same `current_tenant_id()` / `current_role()` helper functions as
`workspaces`/`profiles` (see DD-001, ADR-002).

| Policy | Rule |
|---|---|
| `properties_select_tenant` | `select` where `tenant_id = current_tenant_id()` |
| `properties_insert_tenant` | `insert` with check `tenant_id = current_tenant_id()` |
| `properties_update_tenant` | `update` where/with check `tenant_id = current_tenant_id()` (the `with check` also blocks moving a row to a different tenant via update) |
| `properties_delete_admin` | `delete` where `tenant_id = current_tenant_id()` and `current_role() = 'admin'` |

`service_role` is granted full access on this table (bypasses RLS by design) for the future
migration importer (`tb-migration-preview-001`), which writes into a tenant's `properties` on
the user's behalf from a trusted backend context.

---

## Related Documents

- DS-002 — Properties (Core) (business-entity source for this DD)
- `cap-properties-001` (Theos Registry) — full eventual Property schema and design rationale
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- `supabase/migrations/20260721120000_platform_foundation.sql` — implements this doc

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial version, matching the first platform foundation migration. |
