-- ----------------------------------------------------------------------------
-- tb-migration-deduplication-001: a CSV migration row can now resolve to
-- 'skipped' (conflict, operator kept the default) or 'updated' (conflict,
-- operator chose overwrite) in addition to the existing 'success'/'error'.
-- Same widen-in-place pattern as migration_temp_files_status_check in
-- 20260722130000_import_batches.sql. Contacts are out of scope for this
-- tracer bullet (see its Context) -- imported_contacts' constraint is
-- untouched.
-- ----------------------------------------------------------------------------
alter table public.imported_properties drop constraint imported_properties_status_check;
alter table public.imported_properties add constraint imported_properties_status_check
  check (status in ('success', 'error', 'skipped', 'updated'));

-- import_batches gains per-batch conflict-resolution counts alongside the
-- existing successful_imports/failed_rows, surfaced in the batch-detail
-- response and the import summary email.
alter table public.import_batches add column if not exists skipped_rows int not null default 0;
alter table public.import_batches add column if not exists updated_rows int not null default 0;
