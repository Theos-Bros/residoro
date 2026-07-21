-- ============================================================================
-- Migration: Platform Foundation (Workspace/Tenant, Identity, Properties, RLS)
-- Implements: DD-001_WORKSPACES_AND_PROFILES.md, DD-002_PROPERTIES.md
-- Decisions: ADR-001 (shared-schema multi-tenant), ADR-002 (RLS enforcement)
-- Milestone: mil-platform-foundation-001 (theos-registry)
-- Postgres 17 (gen_random_uuid() is built into core since PG13 — no
-- pgcrypto/uuid-ossp extension needed).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. WORKSPACES  (the tenant/isolation unit — see CTX-007 Glossary "Workspace")
-- ----------------------------------------------------------------------------
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.workspaces is
  'The isolation unit (a brokerage). The column "tenant_id" on other tables '
  'refers to workspaces.id -- "tenant" and "workspace" are the same concept '
  'under two names, see CTX-007 Glossary and DS-001''s naming note.';

-- ----------------------------------------------------------------------------
-- 2. PROFILES  (1:1 with auth.users; carries tenant_id + minimal role)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid references public.workspaces(id) on delete set null,
  role        text not null default 'member' check (role in ('admin', 'member')),
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.profiles.tenant_id is
  'FK to workspaces.id. The handle_new_user trigger always sets this on '
  'signup -- see DS-001 Key Decision re: auto-workspace-on-signup (flagged '
  'as a placeholder, not a final onboarding design).';
comment on column public.profiles.role is
  'Default is the fail-safe "member" -- the signup trigger explicitly '
  'passes "admin" for the workspace creator. Mutable only via the trigger '
  'or service-role access, never by the profile owner directly (see DD-001 '
  'grants: authenticated only gets column-level update on full_name).';

create index if not exists idx_profiles_tenant_id on public.profiles (tenant_id);

-- ----------------------------------------------------------------------------
-- 3. PROPERTIES  (base schema per cap-properties-001 -- this table only)
-- ----------------------------------------------------------------------------
create table if not exists public.properties (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.workspaces(id),
  project_id          uuid,        -- no FK: Project table doesn't exist yet (DD-002 Deviations)
  type                text not null check (type in (
                        'condo_unit', 'house_and_lot', 'lot_only', 'townhouse',
                        'commercial', 'warehouse', 'agricultural', 'industrial'
                      )),
  owner_type          text not null check (owner_type in ('developer', 'individual', 'company')),
  owner_id            uuid not null, -- no FK: polymorphic target doesn't exist yet (DD-002 Deviations)
  title               text not null,
  address             text,
  city                text,
  province            text,
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  floor_area_sqm      numeric(10,2),
  lot_area_sqm        numeric(10,2),
  bedrooms            smallint,
  bathrooms           smallint,
  parking_slots       smallint,
  price               numeric(14,2),
  price_currency      text not null default 'PHP',
  status              text not null default 'available' check (status in (
                        'available', 'reserved', 'sold', 'off_market'
                      )),
  verification_status text not null default 'unverified' check (verification_status in (
                        'unverified', 'pending', 'verified', 'flagged'
                      )),
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on column public.properties.project_id is
  'No FK yet -- Project table not built until mil-properties-projects-001 (DD-002 Deviations).';
comment on column public.properties.owner_id is
  'No FK yet -- polymorphic target (Developer/Contact) not built until later milestones (DD-002 Deviations).';

create index if not exists idx_properties_tenant_id on public.properties (tenant_id);
create index if not exists idx_properties_tenant_status on public.properties (tenant_id, status);

-- ----------------------------------------------------------------------------
-- 4. updated_at MAINTENANCE
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger trg_properties_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. NEW-USER PROVISIONING (placeholder decision -- see DS-001 Key Decision)
--    On signup: auto-create a brand-new workspace, signing-up user becomes
--    its admin. Revisit once an invite-to-existing-workspace flow exists.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant_id uuid;
begin
  insert into public.workspaces (name)
  values (coalesce(new.raw_user_meta_data ->> 'workspace_name', new.email || '''s Workspace'))
  returning id into new_tenant_id;

  insert into public.profiles (id, tenant_id, role, full_name)
  values (
    new.id,
    new_tenant_id,
    'admin',
    new.raw_user_meta_data ->> 'full_name'
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 6. RLS HELPER FUNCTIONS
--    SECURITY DEFINER + owned by the migration role (same owner as the
--    tables) so the inner SELECT on profiles bypasses RLS via ordinary
--    table-owner bypass -- this is what avoids infinite recursion when
--    profiles' own RLS policy calls current_tenant_id(). search_path is
--    pinned to '' with fully-qualified references to prevent search-path
--    hijacking of a SECURITY DEFINER function. See ADR-002.
-- ----------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;

create or replace function public.current_role()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_tenant_id() to authenticated, anon;
grant execute on function public.current_role()      to authenticated, anon;

-- ----------------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.profiles   enable row level security;
alter table public.properties enable row level security;

-- workspaces: a user can see only their own workspace row
create policy workspaces_select_own on public.workspaces
  for select
  using (id = public.current_tenant_id());

create policy workspaces_update_admin on public.workspaces
  for update
  using (id = public.current_tenant_id() and public.current_role() = 'admin')
  with check (id = public.current_tenant_id());

-- profiles: see teammates in the same workspace; only edit your own row
create policy profiles_select_same_tenant on public.profiles
  for select
  using (tenant_id = public.current_tenant_id());

create policy profiles_update_own on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- properties: standard tenant-scoped CRUD
create policy properties_select_tenant on public.properties
  for select
  using (tenant_id = public.current_tenant_id());

create policy properties_insert_tenant on public.properties
  for insert
  with check (tenant_id = public.current_tenant_id());

create policy properties_update_tenant on public.properties
  for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy properties_delete_admin on public.properties
  for delete
  using (tenant_id = public.current_tenant_id() and public.current_role() = 'admin');

-- ----------------------------------------------------------------------------
-- 8. GRANTS
--    Column-level grant on profiles is deliberate: a blanket "update" grant
--    combined with profiles_update_own's row-level check would let a user
--    change their OWN role or tenant_id (RLS restricts which row, not which
--    column). Only full_name is client-updatable; role/tenant_id are
--    mutable only via the SECURITY DEFINER trigger or service-role. See
--    ADR-002 Consequences and DD-001.
--
--    workspaces gets no INSERT grant for authenticated -- the only path
--    that creates a workspace row is the signup trigger (SECURITY DEFINER,
--    needs no grant).
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;

grant select on public.workspaces to authenticated;
grant update on public.workspaces to authenticated;

grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

grant select, insert, update, delete on public.properties to authenticated;

grant all on public.workspaces, public.profiles, public.properties to service_role;
