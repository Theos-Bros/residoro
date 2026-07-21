-- ============================================================================
-- Migration: Migration Temp Files (CSV upload staging for tb-migration-csv-001)
-- Implements: DD-003_MIGRATION_TEMP_FILES.md
-- Decisions: ADR-001 (shared-schema multi-tenant), ADR-002 (RLS enforcement)
-- Tracer Bullet: tb-migration-csv-001 (theos-registry)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MIGRATION_TEMP_FILES
-- ----------------------------------------------------------------------------
create table if not exists public.migration_temp_files (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references public.workspaces(id),
  filename                   text not null,
  file_size_bytes            int not null check (file_size_bytes <= 10485760),
  raw_content                text not null,
  headers                    jsonb not null,
  sample_rows                jsonb not null,
  row_count                  int not null check (row_count <= 10000),
  claude_suggested_mappings  jsonb,
  user_confirmed_mappings    jsonb,
  preview_data               jsonb,
  status                     text not null default 'uploaded' check (status in (
                               'uploaded', 'analyzed', 'previewed'
                             )),
  created_by                 uuid not null references auth.users(id),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  expires_at                 timestamptz not null default (now() + interval '24 hours')
);

comment on table public.migration_temp_files is
  'Per-tenant staging row for one uploaded CSV, spanning upload -> analyze -> preview '
  '(tb-migration-csv-001). Never written to properties from here -- that is a later '
  'tracer bullet. raw_content holds the CSV bytes directly (DD-003 Deviations: no '
  'separate Storage object). expires_at is checked on read, not actively swept yet.';
comment on column public.migration_temp_files.raw_content is
  'CSV bytes as text, capped at 10 MB via file_size_bytes check. See DD-003 Deviations.';
comment on column public.migration_temp_files.expires_at is
  'Enforced lazily by the backend on every read; no scheduled deletion job exists yet '
  '(DD-003 Deviations, follow-up: pg_cron sweep).';

create index if not exists idx_migration_temp_files_tenant_id
  on public.migration_temp_files (tenant_id);
create index if not exists idx_migration_temp_files_tenant_status
  on public.migration_temp_files (tenant_id, status);

create trigger trg_migration_temp_files_updated_at
  before update on public.migration_temp_files
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY
--    Enabled with no policies, and no grants to anon/authenticated -- every
--    access to this table goes through the backend API using service_role
--    (bypasses RLS by role attribute), never queried directly by the
--    frontend. See DD-003's Row-Level Security section for the full
--    rationale. service_role is granted full access, same pattern DD-002
--    used for properties' future migration-importer access.
-- ----------------------------------------------------------------------------
alter table public.migration_temp_files enable row level security;

grant all on public.migration_temp_files to service_role;
