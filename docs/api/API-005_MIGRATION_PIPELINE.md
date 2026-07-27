# API-005 — Migration Pipeline

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

HTTP contract for the CSV upload → analyze → preview → confirm → rollback pipeline. Written
from a 2026-07-27 birds-eye review — from-scratch API spec.

---

## Scope

Covers `/migrations/*`. Does not cover the resulting `properties`/`contacts` writes themselves
(API-002/DD-005) or the enrollment flow that gates who can trigger this (API-006).

---

## Auth

All routes use `requireMigrationAccess` (API-001) — an operator must pass `?tenant_id=`
explicitly to scope the run to a specific client; migration is operator-run per
`cap-client-lifecycle-001`'s Decision #2, not self-served by the brokerage
(`tb-client-lifecycle-migration-execution-001`).

---

## Routes

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| `POST` | `/migrations/upload` | Multipart CSV, `entity_type` | `{ file_id, headers, sample_rows }` | 10 MB / 10,000-row cap (DD-003). Creates a `migration_temp_files` row |
| `POST` | `/migrations/:fileId/analyze` | — | `{ suggested_mappings }` | Deterministic exact-header-string matching (`directMatchHeaders()`) — **not an LLM call**, despite the `claude_suggested_mappings` column name it writes to (DD-003). Real AI-assisted mapping happens in an external Claude session outside the app |
| `POST` | `/migrations/:fileId/preview` | `{ confirmed_mappings }` | `{ preview_data, conflicts }` | Transforms sample rows per confirmed mappings; runs deduplication conflict detection (address-based) against existing records |
| `POST` | `/migrations/:fileId/import` | `{ conflict_resolutions? }` | `{ batch_id, summary }` | Synchronous — writes up to 10,000 rows in one request/response cycle, no job queue. Creates `import_batches` + per-row `imported_properties`/`imported_contacts` (DD-004). Sends an import summary email |
| `GET` | `/migrations/batches/:batchId` | — | Batch detail: counts, `could_not_revert`, per-row status | |
| `POST` | `/migrations/batches/:batchId/rollback` | — | `{ reverted_count, could_not_revert }` | Only within the batch's `rollback_deadline` (workspace-configurable, default 24h — DD-001). Deletes batch-created rows, restores overwritten rows from `previous_data` (DD-004) |

---

## Related Documents

- DD-003 — Migration Temp Files, DD-004 — Import Batches & Row Tracking
- DS-009 — Import Batches & Row Tracking (business rationale for dedup/rollback)
- API-001 — Auth guards this document assumes (`requireMigrationAccess`)
- `cap-migration-001` (Theos Registry) — full pipeline design and MVP decisions
- ADR-002 — Workspace Isolation & Row-Level Security

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review — from-scratch API spec. |
