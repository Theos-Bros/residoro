-- ============================================================================
-- Migration: Import Batches (confirm/import execution for tb-migration-preview-001)
-- Tracer Bullet: tb-migration-preview-001 (theos-registry) -- the actual
-- confirm-and-write-to-production step that migration_temp_files' comment
-- flagged as "a later tracer bullet" when it was created.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Allow migration_temp_files to reach its terminal 'confirmed' state
-- ----------------------------------------------------------------------------
alter table public.migration_temp_files drop constraint migration_temp_files_status_check;
alter table public.migration_temp_files add constraint migration_temp_files_status_check
  check (status in ('uploaded', 'analyzed', 'previewed', 'confirmed'));

-- ----------------------------------------------------------------------------
-- 2. properties.owner_id: allow NULL for CSV-imported rows
--    owner_id was designed NOT NULL with no FK ("polymorphic target doesn't
--    exist yet" per DD-002 Deviations) -- but no target exists at all until
--    tb-migration-contacts-001 ships a Contact entity, so CSV import (this
--    tracer bullet) has no real value to put there. Making it nullable is
--    honest about that; fabricating a random placeholder UUID would not be.
-- ----------------------------------------------------------------------------
alter table public.properties alter column owner_id drop not null;

-- ----------------------------------------------------------------------------
-- 3. IMPORT_BATCHES
--    Per cap-migration-001's Technical Architecture ImportBatch model. Only
--    'importing'/'complete' are reachable yet -- rollback (TB-3, not yet
--    scaffolded) introduces 'rolled_back' when it's actually built, not
--    speculatively added to this constraint now.
-- ----------------------------------------------------------------------------
create table if not exists public.import_batches (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.workspaces(id),
  temp_file_id        uuid not null references public.migration_temp_files(id),
  filename            text not null,
  status              text not null default 'importing' check (status in (
                        'importing', 'complete'
                      )),
  total_rows          int not null,
  successful_imports  int not null default 0,
  failed_rows         int not null default 0,
  mapping_config      jsonb not null,
  rollback_deadline   timestamptz not null,
  created_by          uuid not null references auth.users(id),
  created_at          timestamptz not null default now(),
  imported_at         timestamptz
);

create index if not exists idx_import_batches_tenant_id on public.import_batches (tenant_id);

comment on table public.import_batches is
  'One row per confirmed migration import (tb-migration-preview-001). rollback_deadline is '
  'stored but nothing reads/acts on it yet -- rollback itself is TB-3, not yet scaffolded.';

-- ----------------------------------------------------------------------------
-- 4. IMPORTED_PROPERTIES
--    Per cap-migration-001's ImportedProperty model -- per-row success/error
--    tracking so one bad row never aborts the batch.
-- ----------------------------------------------------------------------------
create table if not exists public.imported_properties (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.import_batches(id),
  property_id    uuid references public.properties(id),
  original_row   jsonb not null,
  mapped_data    jsonb not null,
  status         text not null check (status in ('success', 'error')),
  error_message  text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_imported_properties_batch_id on public.imported_properties (batch_id);

comment on table public.imported_properties is
  'One row per CSV row processed by an import_batches run. property_id is null when '
  'status = error (nothing was created for that row).';

-- ----------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
--    Same posture as migration_temp_files: enabled with no policies, no
--    grants to anon/authenticated -- every access goes through the backend
--    API using service_role, since the frontend never queries these tables
--    directly (it hits GET /migrations/batches/:batchId instead).
-- ----------------------------------------------------------------------------
alter table public.import_batches enable row level security;
alter table public.imported_properties enable row level security;

grant all on public.import_batches, public.imported_properties to service_role;
