-- ============================================================================
-- Migration: Contacts entity & entity-typed migration pipeline
-- Tracer Bullet: tb-migration-contacts-001 (theos-registry)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Let the existing migration pipeline carry a second target entity.
--    Every migration_temp_files / import_batches row up to now was implicitly
--    'property' -- the default backfills that history without a data migration.
-- ----------------------------------------------------------------------------
alter table public.migration_temp_files
  add column entity_type text not null default 'property' check (entity_type in ('property', 'contact'));

alter table public.import_batches
  add column entity_type text not null default 'property' check (entity_type in ('property', 'contact'));

-- ----------------------------------------------------------------------------
-- 2. CONTACTS
--    Generic entity per tb-migration-contacts-001's Context decision: one
--    flexible schema (buyer_lead/co_broker/developer/owner/...) instead of a
--    table per contact kind. `type` is intentionally an open text field, not
--    an enum -- see that tracer bullet's Definition of Done.
-- ----------------------------------------------------------------------------
create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.workspaces(id),
  name        text not null,
  type        text not null,
  email       text,
  phone       text,
  company     text,
  notes       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.contacts.type is
  'Open set (buyer_lead, co_broker, developer, owner, ...) -- deliberately not '
  'constrained to an enum yet. Revisit once real client data shows what values '
  'actually show up (tb-migration-contacts-001 Context).';

create index if not exists idx_contacts_tenant_id on public.contacts (tenant_id);

create trigger trg_contacts_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. IMPORTED_CONTACTS
--    Same per-row success/error tracking pattern as imported_properties --
--    kept as its own table (not a column on contacts) for consistency with
--    that established pattern, rather than the draft doc's original
--    contacts.imported_batch_id column sketch.
-- ----------------------------------------------------------------------------
create table if not exists public.imported_contacts (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.import_batches(id),
  contact_id     uuid references public.contacts(id),
  original_row   jsonb not null,
  mapped_data    jsonb not null,
  status         text not null check (status in ('success', 'error')),
  error_message  text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_imported_contacts_batch_id on public.imported_contacts (batch_id);

comment on table public.imported_contacts is
  'One row per CSV row processed by an import_batches run with entity_type = contact. '
  'contact_id is null when status = error. Mirrors imported_properties.';

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
--    contacts: standard tenant-scoped CRUD, matching properties' pattern
--    (tb-migration-contacts-001 DoD). imported_contacts: service_role only,
--    matching imported_properties -- the frontend never queries it directly.
-- ----------------------------------------------------------------------------
alter table public.contacts enable row level security;
alter table public.imported_contacts enable row level security;

create policy contacts_select_tenant on public.contacts
  for select
  using (tenant_id = public.current_tenant_id());

create policy contacts_insert_tenant on public.contacts
  for insert
  with check (tenant_id = public.current_tenant_id());

create policy contacts_update_tenant on public.contacts
  for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy contacts_delete_admin on public.contacts
  for delete
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

grant select, insert, update, delete on public.contacts to authenticated;
grant all on public.contacts, public.imported_contacts to service_role;
