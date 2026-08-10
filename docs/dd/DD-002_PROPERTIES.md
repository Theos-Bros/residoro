# DD-002 — Properties

**Status:** Draft
**Version:** 2.5.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `properties`, as implemented by
`supabase/migrations/20260721120000_platform_foundation.sql` and four follow-up migrations
through 2026-07-27 (see Revision History).

---

## Scope

Covers only the `public.properties` table. `Project`, `Developer`, and `ProjectUnitType` — no
longer deferred, now shipped — are covered by DD-007. `PropertyMedia`/`PropertyDocument` are
covered by DD-008.

---

## Table: `properties`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `project_id` | `uuid` | nullable, FK → `projects(id)` (added 2026-07-27) | See Deviations below — FK was added once `projects` shipped |
| `type` | `text` | not null, `CHECK` in 8 PH property types | See Type Choices below |
| `owner_type` | `text` | not null, `CHECK` in (`developer`, `individual`, `company`) | |
| `owner_id` | `uuid` | **nullable** (was not null), FK → `contacts(id)` (added 2026-07-28) | See Deviations below — made nullable for CSV-imported rows with no resolvable owner target; FK added once `developers` folded into `contacts` gave it a single canonical target |
| `unit_type_id` | `uuid` | nullable, FK → `project_unit_types(id)` | Added by `tb-properties-bulk-units-001`. Set when a property was stamped out from a unit-type template via bulk generation; null for individually-created or resale properties |
| `unit_number` | `text` | nullable | Added by `tb-properties-project-rollup-001` follow-up. Free-form label for a unit's position (e.g. `"1F"` for condos, `"Block 3 Lot 12"` for house-and-lot). Never backfilled for properties created before this column existed, per explicit user decision — no retroactive migration. Rollup UI falls back to `title` when null |
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
| `status` | `text` | not null, default `'available'`, `CHECK` in (`available`, `reserved`, `sold`, `off_market`, `leased`) | `'leased'` added by `tb-properties-unit-leasing-001` (2026-07-30) — distinct from `listings.listing_type = 'lease'` (renamed from `'rent'` 2026-08-08, see `tb-listings-rent-to-lease-001`), which is active marketing/authority, not that the unit is already leased out |
| `verification_status` | `text` | not null, default `'unverified'`, `CHECK` in (`unverified`, `pending`, `verified`, `flagged`) | |
| `lease_monthly_amount` | `numeric(14,2)` | nullable | Added by `tb-properties-unit-leasing-001` as `lease_monthly_rent`; **renamed to `lease_monthly_amount` 2026-08-08** by `tb-listings-rent-to-lease-001` (0 live rows at rename time, pure schema op). PHP by default like `price`/`price_currency`. Null for every status other than `'leased'`; enforced app-side (`PATCH /properties/:id`), no DB constraint |
| `lease_term_months` | `smallint` | nullable | Same migration. Plain integer duration — no lease start date, no expiry/renewal tracking. Null for every status other than `'leased'`; enforced app-side |
| `created_by` | `uuid` | nullable, FK → `auth.users(id)` | Nullable: future service-role/bulk-import writes may not have a single acting user |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger |
| `search_vector` | `tsvector` | generated always as, stored | Added by `tb-search-core-entities-001` (2026-08-08). `setweight(title, 'A') \|\| setweight(address, 'B')` — title ranks above address. Feeds `search_global()`'s `property` result type; `listing` results are searched via the joined `properties.search_vector`, not a separate column on `listings` |

Indexes: `idx_properties_tenant_id` on `(tenant_id)`, `idx_properties_tenant_status` on
`(tenant_id, status)` — the obvious first query ("list my workspace's available properties")
is composite-indexed from the start. `idx_properties_search_vector` — GIN index on
`search_vector`, added by the same migration as the column.

---

## Deviations From `cap-properties-001`

`cap-properties-001` specifies `project_id` as an FK to `Project` and `owner_id` as a
polymorphic FK to `Developer` or a CRM Contact/Company. As of the original 2026-07-21 migration,
neither target table existed, so both columns were created with no foreign key constraint —
exactly the non-breaking-later-`ADD CONSTRAINT` path this section originally anticipated.

**Update, 2026-07-27:** `project_id` now has a real FK (`properties_project_id_fkey` →
`projects(id)`), added the same day `projects`/`developers` shipped (`tb-properties-project-001`)
— all properties existing at that point had `project_id = null`, so the FK was safe with no
backfill. `owner_id` still has **no FK** — its target remains polymorphic (`developers` or
`contacts`, per `owner_type`), and Postgres has no native polymorphic FK; the correct target
table is enforced only in application code (`listings.ts` POST/PATCH `/properties`), not at the
DB layer. `owner_id` was also made **nullable** (2026-07-22, `tb-migration-preview-001`'s import
batches migration) — CSV-imported properties have no Contact entity to point at until
`tb-migration-contacts-001` ships one, and a fabricated placeholder UUID would have been
dishonest about that gap.

**Update, 2026-07-28:** `owner_id` now has a real FK (`properties_owner_id_fkey` →
`contacts(id)`), added by `tb-crm-owner-fk-001` (Milestone 2 of `cap-crm-001`) once
`tb-crm-developer-consolidation-001` folded the standalone `developers` table into `contacts`
(`contacts.is_company`, see DD-005/DD-007), giving `owner_id` a single canonical target instead
of a polymorphic one. Two pre-existing orphaned rows (test fixtures in a tenant with zero
`contacts` rows) were nulled out manually before the FK was added, per explicit user decision —
not handled by the migration itself.

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

`service_role` is granted full access on this table (bypasses RLS by design). **Update,
2026-07-27 (`tb-platform-rls-scoped-client-001`, per ADR-003):** the tenant-facing property
routes (`application/backend/src/routes/listings.ts`) now use a per-request client scoped to
the caller's own JWT for all `properties` data calls — RLS is the real enforcement boundary for
these routes now, not `service_role`. Live-verified: a cross-tenant read through the scoped
client with no app-level `tenant_id` filter returns empty, not the row
(`verify-rls-scoped-client.ts`). `service_role` is still used for the CSV migration importer
(`migrations.ts`) and other operator/trusted-job routes, per ADR-003 Decision #2.

**Correction (2026-08-10, `tb-platform-grant-lockdown-001`):** this section never actually stated
what `authenticated`'s table-level grant was — a silent gap, not a wrong claim, but the same root
cause as DD-001/DD-014's documented incidents: `authenticated` held Supabase's un-revoked default
table-wide INSERT/UPDATE/DELETE/TRUNCATE the whole time, letting any tenant member write any
column via direct PostgREST regardless of what `listings.ts`'s routes actually exposed. Fixed via
`supabase/migrations/20260810240000_tier1_grant_lockdown.sql`: `revoke all` then re-grant `select`
+ precise `insert`/`update`/`delete` columns matching real route usage (flagged residual gap:
`owner_type`/`owner_id` stay grantable for the legitimate admin PATCH flow, but the app-layer
403-for-non-admin check they're behind isn't mirrored in RLS — a non-admin can still set them via
direct PostgREST; needs an RLS/trigger fix, not a grant fix, tracked in
`tb-platform-grant-lockdown-001`'s What Happens Next). `anon` also closed, holding the identical
default the whole time. Live-verified end-to-end via the real `/properties` routes plus targeted
escalation checks (7/13 + 6/6 checks across two verify scripts).

**Correction (2026-08-10, `tb-properties-owner-admin-lockdown-001`):** closes the residual gap the
previous correction flagged. A new `BEFORE UPDATE` trigger,
`properties_owner_admin_lockdown` (function `enforce_properties_owner_admin_only()`), now mirrors
`PATCH /properties/:id`'s app-layer 403 at the DB level: any `UPDATE` that changes `owner_type` or
`owner_id` is rejected with `42501` unless `current_role() = 'admin'` (the same
`SECURITY DEFINER` role-resolution helper every other admin-gated RLS policy on this table already
uses — no second role mechanism introduced). The columns stay grantable to `authenticated` for the
legitimate admin PATCH flow, exactly as before; the trigger is the enforcement layer RLS couldn't
express. Fires on `UPDATE` only — `POST /properties` has no role check on these columns by design,
and CSV import is insert-only via `service_role`, so neither path is affected. Added via
`supabase/migrations/20260810250000_properties_owner_admin_lockdown.sql`. Live-verified: a
non-admin's direct PostgREST write to `owner_type`/`owner_id` is rejected (42501, ownership
unchanged), the same non-admin's write to an unrelated column (`price`) is unaffected, and an
admin's write to `owner_type`/`owner_id` still succeeds unchanged (4/4 checks,
`verify-properties-owner-admin-lockdown.ts`).

---

## Related Documents

- DS-002 — Properties (Core) (business-entity source for this DD)
- DD-007 — Developers & Projects (`project_id`/`unit_type_id` FK targets)
- `cap-properties-001` (Theos Registry) — full eventual Property schema and design rationale
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- ADR-003 — Scoped-Client Enforcement for Tenant-User-Facing Routes
- `supabase/migrations/20260721120000_platform_foundation.sql` — implements the original table shape
- `supabase/migrations/20260722130000_import_batches.sql` — `owner_id` made nullable
- `supabase/migrations/20260727120000_properties_projects.sql` — `project_id` FK added
- `supabase/migrations/20260727130000_project_unit_types.sql` — `unit_type_id`
- `supabase/migrations/20260727140000_properties_unit_number.sql` — `unit_number`
- `supabase/migrations/20260808140000_search_core_entities.sql` — `search_vector`
- `supabase/migrations/20260810240000_tier1_grant_lockdown.sql` — the grant fix that flagged the
  `owner_type`/`owner_id` residual gap
- `supabase/migrations/20260810250000_properties_owner_admin_lockdown.sql` — the `BEFORE UPDATE`
  trigger that closes it (`tb-properties-owner-admin-lockdown-001`, theos-registry)

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial version, matching the first platform foundation migration. |
| 2.0.0 | 2026-07-27 | Refreshed from a birds-eye technical review: `project_id` FK added, `owner_id` made nullable, `unit_type_id`/`unit_number` added. Corrected the `service_role` Consequences note — usage became universal, not importer-only; pointed to ADR-003 for the corrected target architecture. Structural revision, hence major version bump per STD-002. |
| 2.1.0 | 2026-08-03 | Refreshed from a 2026-08-03 birds-eye review: `owner_id` FK added (→ `contacts(id)`, once `developers` folded into `contacts`), `'leased'` status + `lease_monthly_rent`/`lease_term_months` columns added, and the `service_role`-for-all-routes claim corrected now that `tb-platform-rls-scoped-client-001` moved `properties` reads/writes to a per-request scoped client. |
| 2.2.0 | 2026-08-08 | `tb-listings-rent-to-lease-001`: `lease_monthly_rent` renamed to `lease_monthly_amount` (0 live rows, pure schema op), and the `'leased'` status note's cross-reference to `listings.listing_type = 'rent'` corrected to `'lease'` (that enum value was renamed app-wide in the same tracer bullet). |
| 2.3.0 | 2026-08-09 | Added `search_vector` (`tb-search-core-entities-001`, 2026-08-08 — missed at ship time, caught by a 2026-08-09 birds-eye audit). |
| 2.4.0 | 2026-08-10 | **Correction.** Documented, for the first time, that `authenticated` held an un-revoked table-wide grant this whole doc never mentioned; closed via `20260810240000_tier1_grant_lockdown.sql` (`tb-platform-grant-lockdown-001`). Flags one residual gap (`owner_type`/`owner_id`'s app-layer-only admin check). Correction to previously-silent documentation, not a schema change, hence a minor bump per STD-002. |
| 2.5.0 | 2026-08-10 | **Correction.** Closes the residual gap v2.4.0 flagged: added a `BEFORE UPDATE` trigger (`properties_owner_admin_lockdown` / `enforce_properties_owner_admin_only()`) that rejects (42501) any non-admin change to `owner_type`/`owner_id`, mirroring `PATCH /properties/:id`'s app-layer 403 at the DB level (`tb-properties-owner-admin-lockdown-001`, via `20260810250000_properties_owner_admin_lockdown.sql`). Live-verified 4/4 (`verify-properties-owner-admin-lockdown.ts`). Structural (new trigger/function), hence a minor version bump per STD-002. |
