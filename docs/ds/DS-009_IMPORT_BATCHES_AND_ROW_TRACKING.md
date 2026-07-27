# DS-009 — Import Batches & Row Tracking

**Status:** Draft
**Version:** 1.0.0
**Owner:** Residoro Engineering
**Created:** 2026-07-27
**Last Updated:** 2026-07-27

---

## Purpose

Define Import Batch as a business entity — the confirm-and-write step DS-003 always deferred to
"a later tracer bullet," plus the deduplication and rollback capabilities built on top of it
once it shipped. Written retroactively as part of a 2026-07-27 birds-eye review.

---

## Scope

Covers Import Batch and its per-row tracking (Imported Property, Imported Contact). Does not
cover the staging entity these consume (`migration_temp_files`, DS-003) or the write targets
(Property, DS-002; Contact, DS-005).

---

## Business Entities

### Import Batch

One row per confirmed migration run — the record that `cap-migration-001`'s "zero-trust
migration" principle depends on to be trustworthy: a brokerage needs to know exactly what was
imported, what failed, and be able to undo it, not just trust that a bulk write happened
correctly. Tracks aggregate counts (successful/failed/skipped/updated) and a computed
`rollback_deadline`, derived once at creation time from the Workspace's configurable rollback
window (default 24 hours, DS-006) — changing that Workspace setting later does not retroactively
extend a batch already created, since the deadline is a commitment made at import time.

### Imported Property / Imported Contact

Per-row success/error tracking, kept as separate tables per entity type (mirroring each other's
shape) rather than a single polymorphic table — so one bad row in a 10,000-row CSV never aborts
the whole batch, and so exactly which rows succeeded, failed, were skipped, or were overwritten
is individually auditable and individually reversible.

**Deduplication** (added after the base pipeline shipped): when an imported row conflicts with
an existing record, the operator chooses to keep the existing row (`'skipped'`) or overwrite it
(`'updated'`) — widening the original success/error-only outcome set. An overwrite captures a
`previous_data` snapshot of exactly what it replaced, which is what makes rollback of an
`'updated'` row possible at all; rows imported before this snapshot mechanism existed are
reported as un-revertible rather than the system guessing at data it never captured.

**Rollback** (added after deduplication): reverses a batch within its window — deletes rows this
batch created, restores rows it overwrote from their `previous_data` snapshot. Not a soft
delete or a database transaction rollback; it's an explicit, application-level reversal that
runs after the fact, bounded by the same rollback window the batch's deadline was computed from.

---

## Related Documents

- DD-004 — Import Batches & Row Tracking (implements this doc)
- DS-003 — Migration Temp Files (the upstream staging entity this pipeline consumes)
- DS-002 — Properties, DS-005 — Contacts (write targets)
- DS-006 — Client Lifecycle Operations (`rollback_window_hours`, the Workspace-level setting this entity reads)
- `cap-migration-001` (Theos Registry) — ImportBatch/ImportedProperty model and the zero-trust migration principle
- ADR-001 — Shared-Schema Multi-Tenant Architecture
- ADR-002 — Workspace Isolation & Row-Level Security

---

## Revision History

| Version | Date | Description |
|----------|------|-------------|
| 1.0.0 | 2026-07-27 | Initial version, written retroactively from a birds-eye technical review covering five already-shipped tracer bullets. |
