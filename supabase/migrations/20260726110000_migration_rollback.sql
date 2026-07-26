-- ============================================================================
-- Migration: Import Batch Rollback
-- Tracer Bullet: tb-migration-rollback-001 (theos-registry) -- TB-3, the
-- rollback half of the "batch tracking + rollback" sprint cap-migration-001
-- always described; rollback_deadline has been computed and displayed since
-- tb-migration-preview-001 shipped, but nothing has ever read it until now.
-- ============================================================================

-- previous_data: pre-overwrite snapshot of an 'updated' row's full target
-- record, captured by the overwrite branch in /migrations/:fileId/import
-- (tb-migration-deduplication-001) just before its update call. Null for
-- 'success'/'error'/'skipped' rows, and for any 'updated' row imported before
-- this shipped -- rollback reports those as could_not_revert rather than
-- guessing at a snapshot that was never taken.
alter table public.imported_properties add column if not exists previous_data jsonb;

-- imported_contacts can never reach 'updated' status yet (tb-migration-
-- deduplication-001's dedup/overwrite path is properties-only) -- this column
-- is added here anyway so the rollback endpoint below can stay generic across
-- both tracking tables (keyed by entity_type, same pattern as ENTITY_CONFIG
-- in migrations.ts) without a table-specific branch.
alter table public.imported_contacts add column if not exists previous_data jsonb;

-- import_batches: rollback is now a reachable terminal state, and records
-- when it happened.
alter table public.import_batches add column if not exists rolled_back_at timestamptz;
alter table public.import_batches drop constraint import_batches_status_check;
alter table public.import_batches add constraint import_batches_status_check
  check (status in ('importing', 'complete', 'rolled_back'));
