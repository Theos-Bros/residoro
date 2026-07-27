-- ============================================================================
-- Migration: Project Unit Types + properties.unit_type_id
-- Implements: tb-properties-bulk-units-001 (theos-registry)
-- Resolves the unit-type/floor-plan variation question tb-properties-project-001
-- deliberately left open -- a project can define named templates (1BR/2BR/
-- Penthouse, each with their own size/amenities/price) that bulk unit
-- generation then stamps out as ordinary properties rows.
-- ============================================================================

create table if not exists public.project_unit_types (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.workspaces(id),
  project_id      uuid not null references public.projects(id),
  name            text not null,
  property_type   text not null check (property_type in (
                    'condo_unit', 'house_and_lot', 'lot_only', 'townhouse',
                    'commercial', 'warehouse', 'agricultural', 'industrial'
                  )),
  floor_area_sqm  numeric(10,2),
  lot_area_sqm    numeric(10,2),
  bedrooms        smallint,
  bathrooms       smallint,
  parking_slots   smallint,
  price           numeric(14,2),
  price_currency  text not null default 'PHP',
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_project_unit_types_tenant_id on public.project_unit_types (tenant_id);
create index if not exists idx_project_unit_types_project_id on public.project_unit_types (project_id);

alter table public.project_unit_types enable row level security;

-- No update route exposed in v1 (tb-properties-bulk-units-001 semantic_scope --
-- create-only, a wrong template is fixed by creating a new one), but the
-- update policy exists ahead of the route anyway, matching properties'/
-- projects' own precedent of RLS existing before every route that could use it.
create policy project_unit_types_select_tenant on public.project_unit_types
  for select
  using (tenant_id = public.current_tenant_id());

create policy project_unit_types_insert_tenant on public.project_unit_types
  for insert
  with check (tenant_id = public.current_tenant_id());

create policy project_unit_types_update_tenant on public.project_unit_types
  for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy project_unit_types_delete_admin on public.project_unit_types
  for delete
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

grant select, insert, update, delete on public.project_unit_types to authenticated;
grant all on public.project_unit_types to service_role;

create trigger trg_project_unit_types_updated_at
  before update on public.project_unit_types
  for each row execute function public.set_updated_at();

alter table public.properties
  add column if not exists unit_type_id uuid references public.project_unit_types(id);

create index if not exists idx_properties_unit_type_id on public.properties (unit_type_id);
