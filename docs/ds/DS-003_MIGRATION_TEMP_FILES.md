# DS-003 — Migration Temp Files

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-21
**Last Updated:** 2026-07-21

---

## Purpose

Define the temporary staging entity for CSV migration as a residoro DS document, ahead of
DD-003 and the SQL migration that implements it. Same role DS-002 played for `cap-properties-001`:
translate a schema already decided in the Theos Registry (`cap-migration-001`,
`tb-migration-csv-001`) into residoro's own ADR→DS→DD→SQL order, rather than skipping it because
the decision already exists elsewhere.

---

## Scope

Covers only `migration_temp_files` — a per-tenant, time-boxed staging row that holds one
uploaded CSV (raw content + parsed headers/sample rows) through the upload → analyze → preview
flow defined by `tb-migration-csv-001`. Does **not** cover: writing to `properties` (that's
`tb-migration-preview-001` / `mil-migration-import-001`), `ImportBatch` tracking (same,
deferred), deduplication/conflict handling (`mil-migration-deduplication-001`), or Excel/JSON/API
import formats (future tracer bullets per `cap-migration-001`'s "CSV only for v1" scope).

---

## Business Entity: Migration Temp File

Source of truth for the flow and constraints this entity supports: `cap-migration-001` (Theos
Registry) and `tb-migration-csv-001`'s Technical Design + Definition of Done. Summarized here:

- One row per uploaded CSV, scoped to the uploading user's tenant (`workspaces.id`) — never a
  client-supplied tenant id, always derived server-side from the authenticated user's
  `profiles.tenant_id` (see ADR-002; DD-002 established this pattern for the migration
  importer's trusted-backend-context access).
- Fixed MVP limits from `cap-migration-001`'s Decisions: **10 MB** file size, **10,000 rows**.
- Row lifecycle: `uploaded` → `analyzed` (Claude's suggested mappings stored) → `previewed`
  (user's confirmed mappings + transformed sample stored). No further state in this tracer
  bullet — the row is never applied to `properties`; that happens in a later tracer bullet
  which reads this same row.
- `expires_at` (24h from creation, per DoD) is enforced by checking the timestamp on every read
  and treating an expired row as gone (user re-uploads) — no scheduled deletion job exists yet.
  See DD-003 Deviations for why, and for the deferred cron follow-up.

---

## Deviations From `tb-migration-csv-001` in This Slice

`tb-migration-csv-001`'s Technical Design is illustrative pseudocode written before residoro's
real stack and schema existed: it references a `tenants` table (residoro's is `workspaces`, per
DD-001), a client-supplied `brokerage_id` (residoro never trusts a client-supplied tenant id —
see above), and a separate "temp storage" for the file distinct from the row itself. This DS
instead stores the raw CSV as a `text` column on the row (10 MB fits comfortably in Postgres
`text`, and Supabase's at-rest encryption satisfies the doc's "encrypted temp storage" intent
without a separate Storage bucket + policies). See DD-003 for the exact column definitions.

---

## Related Documents

- `cap-migration-001` (Theos Registry) — source of truth for the migration capability and its
  MVP Decisions (file/row limits, CSV-only scope)
- `tb-migration-csv-001` (Theos Registry) — source of truth for this slice's end-to-end flow and
  Definition of Done
- ADR-001 — Shared-Schema Multi-Tenant Architecture (this table's `tenant_id` column)
- ADR-002 — Workspace Isolation & Row-Level Security (this table's RLS policies, trusted-backend
  access pattern)
- DD-003 — Migration Temp Files (implements this doc)

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-21 | Initial draft, written alongside DD-003 and the migration_temp_files SQL migration. |
