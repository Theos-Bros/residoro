# TS-004 — Migration Pipeline Implementation

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Document the internal implementation of the CSV migration pipeline — mapping, deduplication,
rollback — beyond its HTTP contract (API-005). Written from a 2026-07-27 birds-eye technical
review.

---

## Scope

Covers `application/backend/src/lib/mapping.ts` and the dedup/rollback logic in
`routes/migrations.ts`. Does not cover the HTTP contract (API-005) or the schema (DD-003/DD-004).

---

## Field Mapping

`/migrations/:fileId/analyze` calls `directMatchHeaders()` — a deterministic exact-string
matcher between uploaded CSV headers and known target fields. **This is not an LLM call.** The
`migration_temp_files.claude_suggested_mappings` column name (DD-003) is a holdover from the
original design; real AI-assisted mapping now happens in an external Claude session outside the
app entirely (`tb-migration-manual-mapping-001`, `tb-migration-detail-extraction-001`) — a
brokerage's operator pre-maps headers externally, then confirms/adjusts them in-app via
`user_confirmed_mappings`. Worth correcting in any future rename pass, since the current name
implies a live AI dependency this codepath doesn't have.

---

## Deduplication

Runs during `/migrations/:fileId/preview`, before any write happens. Conflict detection is
**address-based** — an imported row is checked against existing `properties` rows for the same
tenant by matching normalized address fields. On conflict, the operator chooses per-row: keep
the existing record (`'skipped'`) or overwrite it (`'updated'`). An overwrite captures a
`previous_data` snapshot (DD-004) of exactly what it replaced before applying the update — this
snapshot is what makes rollback of an `'updated'` row possible at all.

---

## Import Execution

`/migrations/:fileId/import` is **synchronous** — up to 10,000 rows written in one HTTP
request/response cycle, no job queue (see TS-001's Known Gaps). Each row's outcome
(`success`/`error`/`skipped`/`updated`) is tracked individually so one bad row never aborts the
batch. An import summary email is sent on completion.

---

## Rollback

Bounded by `import_batches.rollback_deadline`, computed once at import time from the workspace's
`rollback_window_hours` (default 24h, DD-001) — not retroactively affected by a later change to
that setting. Rollback deletes rows the batch created and restores rows it overwrote from their
`previous_data` snapshot; rows with no snapshot (imported before this mechanism existed, or
never overwritten) are reported in `could_not_revert` rather than guessed at.

**FK ordering gotcha** (found during this feature's own live verification): `imported_properties
.property_id`/`imported_contacts.contact_id` have no `ON DELETE` clause, so deleting a
`'success'` row's target property/contact while its own tracking row still points at it violates
the FK. The rollback endpoint nulls the tracking row's FK column first, then deletes the target
— an application-code ordering fix, not a schema constraint.

---

## Related Documents

- API-005 — Migration Pipeline (the HTTP contract this document's internals sit behind)
- DD-003 — Migration Temp Files, DD-004 — Import Batches & Row Tracking
- DS-009 — Import Batches & Row Tracking (business rationale)
- TS-001 — Backend Architecture (the synchronous-execution gap this pipeline is the primary instance of)

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written from a birds-eye technical review. |
