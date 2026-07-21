# DD-003 — Migration Temp Files

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-21

---

## Purpose

Exact table/column/constraint definitions for `migration_temp_files`, as implemented by
`supabase/migrations/20260721190000_migration_temp_files.sql`.

---

## Scope

Covers only the `public.migration_temp_files` table. Does not cover writes to `properties` (a
later tracer bullet reads this table's confirmed state to perform those writes).

---

## Table: `migration_temp_files`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Returned to the client as `file_id` |
| `tenant_id` | `uuid` | not null, FK → `workspaces(id)` | Derived server-side from the uploader's `profiles.tenant_id`; never accepted from the request body |
| `filename` | `text` | not null | Original filename as uploaded |
| `file_size_bytes` | `int` | not null, `CHECK (file_size_bytes <= 10485760)` | 10 MB cap per `cap-migration-001` Decisions |
| `raw_content` | `text` | not null | The CSV bytes, stored as text. See Deviations below for why this isn't a separate Storage object |
| `headers` | `jsonb` | not null | CSV column names, as detected on upload |
| `sample_rows` | `jsonb` | not null | First 3 data rows, used to build the Claude prompt |
| `row_count` | `int` | not null, `CHECK (row_count <= 10000)` | 10,000-row cap per `cap-migration-001` Decisions |
| `claude_suggested_mappings` | `jsonb` | nullable | Set by the `/analyze` step |
| `user_confirmed_mappings` | `jsonb` | nullable | Set by the `/preview` step |
| `preview_data` | `jsonb` | nullable | Transformed sample properties, set by the `/preview` step |
| `status` | `text` | not null, default `'uploaded'`, `CHECK` in (`uploaded`, `analyzed`, `previewed`) | Linear lifecycle for this tracer bullet only — no `imported` state yet |
| `created_by` | `uuid` | not null, FK → `auth.users(id)` | Not null (unlike `properties.created_by`) — every row is created by an authenticated upload request, never a service-role bulk path |
| `created_at` | `timestamptz` | not null, default `now()` | |
| `updated_at` | `timestamptz` | not null, default `now()` | Maintained by `set_updated_at()` trigger, reused from `DD-001` |
| `expires_at` | `timestamptz` | not null, default `now() + interval '24 hours'` | Checked on every read; not actively cleaned up yet — see Deviations |

Indexes: `idx_migration_temp_files_tenant_id` on `(tenant_id)`, `idx_migration_temp_files_tenant_status`
on `(tenant_id, status)` — mirrors `DD-002`'s composite-index rationale.

---

## Deviations From `tb-migration-csv-001`

`tb-migration-csv-001`'s Technical Design section is illustrative pseudocode predating
residoro's real stack: it names a `tenants` table (residoro's is `workspaces` — `DD-001`), a
client-supplied `brokerage_id` in request bodies (residoro derives tenant server-side, never
from the client — see `ADR-002`), and "temp storage (encrypted)" as something distinct from the
row itself.

This DD stores the CSV as a `raw_content text` column on the row rather than a Supabase Storage
object. At the 10 MB ceiling this is well within Postgres's comfort zone, Supabase encrypts
disk storage at rest already (satisfying the doc's "encrypted" intent), and it collapses file
lifecycle and row lifecycle into one thing — a single `expires_at` covers both instead of
needing to keep a DB row and a Storage object in sync.

**`expires_at` is enforced lazily, not by a scheduled job.** Every backend read of a
`migration_temp_files` row checks `expires_at < now()` and treats an expired row as not found,
prompting re-upload. This satisfies `tb-migration-csv-001`'s Definition of Done
("File expires from temp storage after 24 hours") from the user's perspective without building
scheduler infrastructure that doesn't exist yet in residoro. **Follow-up, not built here:** a
`pg_cron` job (or equivalent) to actually `DELETE` expired rows — until that exists, expired
rows remain in the table (inert, inaccessible via the API) rather than being purged. Flagging so
this isn't mistaken for an oversight.

---

## Row-Level Security

RLS is **enabled with no policies defined**, and no `SELECT`/`INSERT`/`UPDATE`/`DELETE` grants
are given to `anon` or `authenticated` — stronger than the tenant-scoped-policy pattern
`properties` uses, and appropriate here because, unlike `properties`, nothing in this tracer
bullet's design ever has the frontend query `migration_temp_files` directly: every access goes
through the backend API (`POST /migrations/...`), which uses `service_role` (bypasses RLS by
role attribute, same as `DD-002` established for the future migration importer's "trusted
backend context"). If a future tracer bullet needs direct client reads of this table, add
tenant-scoped policies then rather than pre-building unused ones now.

---

## Related Documents

- DS-003 — Migration Temp Files (business-entity source for this DD)
- `cap-migration-001` (Theos Registry) — MVP Decisions (file/row limits, CSV-only scope)
- `tb-migration-csv-001` (Theos Registry) — full end-to-end flow and Definition of Done this
  table supports
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- DD-001 — Workspaces & Profiles (`set_updated_at()` trigger reused here)
- DD-002 — Properties (the eventual write target once `tb-migration-preview-001` is built)
- `supabase/migrations/20260721190000_migration_temp_files.sql` — implements this doc

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial version, matching the migration_temp_files migration for tb-migration-csv-001. |
