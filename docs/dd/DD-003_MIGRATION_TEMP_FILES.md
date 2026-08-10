# DD-003 — Migration Temp Files

**Status:** Draft
**Version:** 2.1.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-08-10

---

## Purpose

Exact table/column/constraint definitions for `migration_temp_files`, as implemented by
`supabase/migrations/20260721190000_migration_temp_files.sql` and one follow-up migration
through 2026-07-22.

---

## Scope

Covers only the `public.migration_temp_files` table. Writes to `properties`/`contacts` and their
own tracking tables (`import_batches`, `imported_properties`, `imported_contacts`) — the "later
tracer bullet" this doc originally deferred to — are now shipped; see DD-004.

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
| `claude_suggested_mappings` | `jsonb` | nullable | Set by the `/analyze` step. **Naming is misleading as of `tb-migration-manual-mapping-001`**: `/analyze` now runs `directMatchHeaders()` (`application/backend/src/lib/mapping.ts`), a deterministic exact-header-string matcher — no Claude/LLM call happens in this codepath. The column name is a holdover from `tb-migration-csv-001`'s original design (external Claude pre-mapping happens outside the app now, per `tb-migration-manual-mapping-001` and `tb-migration-detail-extraction-001`); left unrenamed to avoid an unnecessary migration, but flagging so it isn't read as implying a live AI dependency that isn't wired up |
| `user_confirmed_mappings` | `jsonb` | nullable | Set by the `/preview` step |
| `preview_data` | `jsonb` | nullable | Transformed sample properties, set by the `/preview` step |
| `entity_type` | `text` | not null, default `'property'`, `CHECK` in (`property`, `contact`) | Added by `tb-migration-contacts-001`. Every pre-existing row backfilled to `'property'` (no data migration needed — that was the only entity type before this column existed) |
| `status` | `text` | not null, default `'uploaded'`, `CHECK` in (`uploaded`, `analyzed`, `previewed`, `confirmed`) | `'confirmed'` added by `tb-migration-preview-001`'s import-batches migration — see Deviations below, "no imported state yet" is no longer true |
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
this isn't mistaken for an oversight. **Still true as of 2026-07-27** — three `pg_cron` jobs
exist in the schema now (contract-expiry, training-reminder, listing-authority-expiry), so the
infrastructure to add this exists, but no job targets this table's cleanup.

**Update, 2026-07-27:** the confirm/import step this doc originally deferred to "a later tracer
bullet" has shipped (`tb-migration-preview-001`) — `status` now reaches `'confirmed'`, and
confirmed rows drive real writes into `import_batches`/`imported_properties`/`imported_contacts`
and, through those, `properties`/`contacts`. See DD-004 for that full pipeline.

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

**Correction (2026-08-10, `tb-platform-grant-lockdown-001`):** "no grants... to anon or
authenticated" was aspirational, not actual — both held Supabase's un-revoked table-wide default
the whole time. Never exploitable (RLS's zero-policy default-deny already blocked every command
regardless of the grant), but the same latent "one future policy away" risk Finding 8 flagged
platform-wide. Closed via `supabase/migrations/20260810210000_tier3_zero_policy_grant_lockdown.sql`
— this section's claim is now actually true, not just intended.

---

## Related Documents

- DS-003 — Migration Temp Files (business-entity source for this DD)
- DD-004 — Import Batches & Row Tracking (the write pipeline this table's `'confirmed'` state feeds)
- DD-005 — Contacts (the second `entity_type`)
- `cap-migration-001` (Theos Registry) — MVP Decisions (file/row limits, CSV-only scope)
- `tb-migration-csv-001` (Theos Registry) — full end-to-end flow and Definition of Done this
  table supports
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security
- DD-001 — Workspaces & Profiles (`set_updated_at()` trigger reused here)
- DD-002 — Properties (a write target via DD-004's pipeline)
- `supabase/migrations/20260721190000_migration_temp_files.sql` — implements the original table shape
- `supabase/migrations/20260722130000_import_batches.sql` — `'confirmed'` status
- `supabase/migrations/20260722140000_contacts.sql` — `entity_type`

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial version, matching the migration_temp_files migration for tb-migration-csv-001. |
| 2.0.0 | 2026-07-27 | Refreshed from a birds-eye technical review: `entity_type` and `'confirmed'` status added; corrected the "no imported state yet" claim (now false, see DD-004); flagged `claude_suggested_mappings` as a misleading column name (no LLM call in that codepath). Structural revision, hence major version bump per STD-002. |
| 2.1.0 | 2026-08-10 | **Correction.** "No grants to anon/authenticated" wasn't actually true until this date — closed via `20260810210000_tier3_zero_policy_grant_lockdown.sql` (`tb-platform-grant-lockdown-001`). Not previously exploitable (RLS already default-denied with zero policies). Correction to previously-inaccurate documentation, hence a minor bump per STD-002. |
