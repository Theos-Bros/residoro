# DD-004 — Import Batches & Row Tracking

**Status:** Draft
**Version:** 1.1.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `import_batches`, `imported_properties`, and
`imported_contacts` — the write pipeline that turns a `'confirmed'` `migration_temp_files` row
(DD-003) into real `properties`/`contacts` rows, with per-row success/error tracking and
rollback support. Written retroactively as part of a 2026-07-27 birds-eye review — these tables
shipped across five tracer bullets (`tb-migration-preview-001`, `tb-migration-contacts-001`,
`tb-migration-deduplication-001`, `tb-migration-rollback-001`, `tb-migration-rollback-window-001`)
with no DD ever written for them.

---

## Scope

Covers `public.import_batches`, `public.imported_properties`, and `public.imported_contacts`.
Does not cover `migration_temp_files` (DD-003), `properties` (DD-002), or `contacts` (DD-005) —
the tables these write into.

---

## Table: `import_batches`

One row per confirmed migration import run.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | |
| `temp_file_id` | `uuid` | not null, FK → `migration_temp_files(id)` | |
| `entity_type` | `text` | not null, default `'property'`, `CHECK` in (`property`, `contact`) | Added by `tb-migration-contacts-001`; mirrors `migration_temp_files.entity_type` |
| `filename` | `text` | not null | |
| `status` | `text` | not null, default `'importing'`, `CHECK` in (`importing`, `complete`, `rolled_back`) | `'rolled_back'` added by `tb-migration-rollback-001` |
| `total_rows` | `int` | not null | |
| `successful_imports` | `int` | not null, default `0` | |
| `failed_rows` | `int` | not null, default `0` | |
| `skipped_rows` | `int` | not null, default `0` | Added by `tb-migration-deduplication-001` — conflict, operator kept the existing row |
| `updated_rows` | `int` | not null, default `0` | Same migration — conflict, operator chose overwrite |
| `mapping_config` | `jsonb` | not null | Snapshot of the confirmed header→field mapping used for this run |
| `rollback_deadline` | `timestamptz` | not null | Computed at creation from `workspaces.rollback_window_hours` (default 24h) — changing the workspace setting later does not retroactively affect batches already created |
| `rolled_back_at` | `timestamptz` | nullable | Added by `tb-migration-rollback-001` |
| `could_not_revert` | `jsonb` | not null, default `'[]'::jsonb` | Added by a `tb-migration-rollback-001` follow-up migration. List of target ids the rollback action could not delete/restore, for any reason — persisted so `GET /migrations/batches/:batchId` can return exactly what rollback found without re-deriving it from tracking-row state on every read |
| `created_by` | `uuid` | not null, FK → `auth.users(id)` | |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `imported_at` | `timestamptz` | nullable | |

Index: `idx_import_batches_tenant_id` on `(tenant_id)`.

## Table: `imported_properties`

One row per CSV row processed by an `import_batches` run with `entity_type = 'property'`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `batch_id` | `uuid` | not null, FK → `import_batches(id)` | |
| `property_id` | `uuid` | nullable, FK → `properties(id)`, **no `ON DELETE` clause** | Null when `status = 'error'`. See Rollback FK Ordering below for the no-`ON DELETE` gotcha |
| `original_row` | `jsonb` | not null | Raw CSV row as uploaded |
| `mapped_data` | `jsonb` | not null | Row after header→field mapping/transformation |
| `previous_data` | `jsonb` | nullable | Added by `tb-migration-rollback-001`. Pre-overwrite snapshot of an `'updated'` row's full target record, captured just before the overwrite branch's update call. Null for `'success'`/`'error'`/`'skipped'` rows, and for any `'updated'` row imported before this column existed — rollback reports those as `could_not_revert` rather than guessing at a snapshot that was never taken |
| `status` | `text` | not null, `CHECK` in (`success`, `error`, `skipped`, `updated`) | `'skipped'`/`'updated'` added by `tb-migration-deduplication-001` |
| `error_message` | `text` | nullable | |
| `created_at` | `timestamptz` | not null, default `now()` | |

Index: `idx_imported_properties_batch_id` on `(batch_id)`.

**Rollback FK ordering (found during `tb-migration-rollback-001`'s own live verification):**
`property_id` has no `ON DELETE` clause, so deleting a `'success'` row's target property while
its own `imported_properties` row still points at it violates the FK. The rollback endpoint
(`application/backend/src/routes/migrations.ts`) nulls the tracking row's `property_id` first,
then deletes the target — application-code ordering, not a DB-level cascade.

## Table: `imported_contacts`

Mirrors `imported_properties` exactly, for `entity_type = 'contact'` batches. Added by
`tb-migration-contacts-001`; `previous_data` added by `tb-migration-rollback-001` for structural
consistency with `imported_properties` even though contacts can never actually reach `'updated'`
status yet (`tb-migration-deduplication-001`'s dedup/overwrite path is properties-only).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `batch_id` | `uuid` | not null, FK → `import_batches(id)` | |
| `contact_id` | `uuid` | nullable, FK → `contacts(id)`, **no `ON DELETE` clause** | Same ordering caveat as `imported_properties.property_id` |
| `original_row` | `jsonb` | not null | |
| `mapped_data` | `jsonb` | not null | |
| `previous_data` | `jsonb` | nullable | Present for structural symmetry; never populated in practice today (see above) |
| `status` | `text` | not null, `CHECK` in (`success`, `error`) | Never reaches `'skipped'`/`'updated'` in current code — the wider constraint on `imported_properties` was not mirrored here since contacts dedup doesn't exist |
| `error_message` | `text` | nullable | |
| `created_at` | `timestamptz` | not null, default `now()` | |

Index: `idx_imported_contacts_batch_id` on `(batch_id)`.

---

## Row-Level Security

All three tables: RLS **enabled with no policies, no grants to `anon`/`authenticated`** — same
posture as `migration_temp_files` (DD-003) and `contract_notifications` (DD-001). Every access
goes through the backend API using the service-role client; the frontend never queries these
tables directly (it hits `GET /migrations/batches/:batchId` instead).

**Correction (2026-08-10, `tb-platform-grant-lockdown-001`):** "no grants to anon/authenticated"
wasn't actually true until this date on any of the three tables — Supabase's un-revoked default
was present, never exploitable given RLS's zero-policy default-deny, but latent. Closed via
`supabase/migrations/20260810210000_tier3_zero_policy_grant_lockdown.sql`.

---

## Related Documents

- DD-003 — Migration Temp Files (the upstream table this pipeline consumes)
- DD-002 — Properties, DD-005 — Contacts (write targets)
- DD-001 — Workspaces & Profiles (`rollback_window_hours` source)
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- `cap-migration-001` (Theos Registry) — ImportBatch/ImportedProperty model and dedup/rollback decisions
- `supabase/migrations/20260722130000_import_batches.sql` — original `import_batches`/`imported_properties`
- `supabase/migrations/20260722140000_contacts.sql` — `entity_type` columns, `imported_contacts`
- `supabase/migrations/20260726100000_migration_deduplication.sql` — `skipped`/`updated` status, `skipped_rows`/`updated_rows`
- `supabase/migrations/20260726110000_migration_rollback.sql` — `previous_data`, `rolled_back_at`
- `supabase/migrations/20260726111500_migration_rollback_result.sql` — `could_not_revert`
- `supabase/migrations/20260726120000_migration_rollback_window.sql` — `workspaces.rollback_window_hours` (DD-001)

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering five already-shipped tracer bullets. |
| 1.1.0 | 2026-08-10 | **Correction.** "No grants to anon/authenticated" wasn't actually true until this date — closed via `20260810210000_tier3_zero_policy_grant_lockdown.sql` (`tb-platform-grant-lockdown-001`). Not previously exploitable. Correction to previously-inaccurate documentation, hence a minor bump per STD-002. |
