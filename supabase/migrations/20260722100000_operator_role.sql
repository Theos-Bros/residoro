-- ============================================================================
-- Migration: Operator Role
-- Implements: tb-client-lifecycle-operator-access-001 (theos-registry)
--
-- Adds a platform-wide "operator" role, distinct from the existing tenant-
-- scoped "admin"/"member" roles on profiles. Operators are NOT assigned a
-- workspace (tenant_id stays null) -- they act across all tenants via
-- backend routes using the service-role client (same "no RLS policy,
-- service-role-only" precedent already established by migration_temp_files),
-- not via RLS-level access. No RLS policy changes are needed here: every
-- existing policy compares against current_tenant_id(), which is null for an
-- operator, so operators simply see nothing via direct/RLS-authenticated
-- access -- consistent with intent.
-- ============================================================================

-- 1. Allow 'operator' as a role value
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'member', 'operator'));

comment on column public.profiles.role is
  'Default is the fail-safe "member" -- the signup trigger explicitly '
  'passes "admin" for the workspace creator, or "operator" (tenant_id '
  'null) when invited with raw_user_meta_data->>''app_role'' = ''operator'' '
  '(see tb-client-lifecycle-operator-access-001). Mutable only via the '
  'trigger or service-role access, never by the profile owner directly '
  '(see DD-001 grants: authenticated only gets column-level update on '
  'full_name).';

-- ----------------------------------------------------------------------------
-- 2. Extend handle_new_user(): operator branch
--    Operator accounts are only ever created via the create-operator script
--    (service-role Admin API invite, application/backend/src/scripts/
--    create-operator.ts) -- never through a public endpoint. There is no
--    public signup path in Residoro at all (see tb-client-lifecycle-
--    operator-access-001's Context), so raw_user_meta_data->>'app_role' is
--    never attacker-controlled: only someone holding the service-role key
--    can set it.
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
  if new.raw_user_meta_data ->> 'app_role' = 'operator' then
    insert into public.profiles (id, tenant_id, role, full_name)
    values (new.id, null, 'operator', new.raw_user_meta_data ->> 'full_name');

    return new;
  end if;

  -- Existing default behavior, unchanged: auto-create a workspace, signing-up
  -- user becomes its admin. Revisiting this for invited *brokerage* users
  -- (assigning them to an existing workspace instead) is
  -- tb-client-lifecycle-enrollment-001's job, not this one.
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
