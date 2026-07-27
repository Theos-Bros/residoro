-- ============================================================================
-- Migration: Project/Development Entity + Property Linking
-- Implements: tb-properties-project-001 (theos-registry)
-- Live-verification ahead of this migration (2026-07-27, via
-- `supabase db query --linked`) found no `developers` table exists despite
-- cap-properties-001's Technical Architecture describing one -- it was a
-- proposed model, never shipped. This migration creates both `developers`
-- and `projects` together, since the latter's FK depends on the former. All
-- 15 existing properties have project_id = null, so the FK added below is
-- safe with no backfill.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. DEVELOPERS
--    Minimal placeholder entity (cap-properties-001 Decision #2) -- just
--    enough to unblock Project.developer_id and, later, Property.owner_id.
--    Superseded by a real CRM Company record once that domain exists.
-- ----------------------------------------------------------------------------
create table if not exists public.developers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.workspaces(id),
  name          text not null,
  contact_info  jsonb,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_developers_tenant_id on public.developers (tenant_id);

alter table public.developers enable row level security;

create policy developers_select_tenant on public.developers
  for select
  using (tenant_id = public.current_tenant_id());

create policy developers_insert_tenant on public.developers
  for insert
  with check (tenant_id = public.current_tenant_id());

create policy developers_update_tenant on public.developers
  for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy developers_delete_admin on public.developers
  for delete
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

grant select, insert, update, delete on public.developers to authenticated;
grant all on public.developers to service_role;

create trigger trg_developers_updated_at
  before update on public.developers
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. PROJECTS
--    Developer inventory container (cap-properties-001 Milestone 2). Bulk
--    unit generation and rollup views are deliberately NOT this tracer
--    bullet's scope (tb-properties-project-001 semantic_scope) -- this
--    migration only makes the entity itself and the FK real.
-- ----------------------------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.workspaces(id),
  developer_id  uuid not null references public.developers(id),
  name          text not null,
  project_type  text not null check (project_type in (
                  'condo', 'subdivision', 'township', 'mixed_use'
                )),
  location      text,
  total_units   integer,
  status        text not null default 'pre_selling' check (status in (
                  'pre_selling', 'under_construction', 'ready_for_occupancy', 'sold_out'
                )),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_projects_tenant_id on public.projects (tenant_id);
create index if not exists idx_projects_developer_id on public.projects (developer_id);

alter table public.projects enable row level security;

create policy projects_select_tenant on public.projects
  for select
  using (tenant_id = public.current_tenant_id());

create policy projects_insert_tenant on public.projects
  for insert
  with check (tenant_id = public.current_tenant_id());

create policy projects_update_tenant on public.projects
  for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy projects_delete_admin on public.projects
  for delete
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;

create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. WIRE properties.project_id AS A REAL FK
--    Column has existed since mil-platform-foundation-001's migration
--    (tb-properties-schema-001) with no FK target until now.
-- ----------------------------------------------------------------------------
alter table public.properties
  add constraint properties_project_id_fkey
  foreign key (project_id) references public.projects(id);

create index if not exists idx_properties_project_id on public.properties (project_id);
