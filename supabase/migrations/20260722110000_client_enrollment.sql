-- ============================================================================
-- Migration: Client Enrollment
-- Implements: tb-client-lifecycle-enrollment-001 (theos-registry)
--
-- 1. Adds contract dates to workspaces (recorded at enrollment, read later by
--    tb-client-lifecycle-contract-expiry-001).
-- 2. Extends handle_new_user() with a third branch: an operator-invited
--    brokerage admin joining an EXISTING workspace (raw_user_meta_data->>
--    'tenant_id'), instead of always auto-creating a brand-new one. Only the
--    enrollment endpoint (service-role, POST /admin/clients) ever sets
--    tenant_id in invite metadata, mirroring the trust argument already made
--    for the operator branch in 20260722100000_operator_role.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Contract dates on workspaces
--    Added nullable first and backfilled from created_at so any pre-existing
--    workspace rows (e.g. from earlier tracer bullets' testing) don't fail
--    the NOT NULL constraint below -- every workspace created going forward
--    goes through POST /admin/clients, which always supplies real dates.
-- ----------------------------------------------------------------------------
alter table public.workspaces
  add column if not exists contract_start_date date,
  add column if not exists contract_end_date date;

update public.workspaces
  set contract_start_date = coalesce(contract_start_date, created_at::date),
      contract_end_date   = coalesce(contract_end_date, created_at::date)
  where contract_start_date is null or contract_end_date is null;

alter table public.workspaces
  alter column contract_start_date set not null,
  alter column contract_end_date set not null;

comment on column public.workspaces.contract_start_date is
  'Set at enrollment via POST /admin/clients (tb-client-lifecycle-enrollment-001). '
  'Read by tb-client-lifecycle-contract-expiry-001 to drive warnings/enforcement.';
comment on column public.workspaces.contract_end_date is
  'Set at enrollment via POST /admin/clients (tb-client-lifecycle-enrollment-001). '
  'Read by tb-client-lifecycle-contract-expiry-001 to drive warnings/enforcement.';

-- ----------------------------------------------------------------------------
-- 2. Extend handle_new_user(): invited-into-existing-workspace branch
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant_id uuid;
  invited_tenant_id uuid;
begin
  if new.raw_user_meta_data ->> 'app_role' = 'operator' then
    insert into public.profiles (id, tenant_id, role, full_name)
    values (new.id, null, 'operator', new.raw_user_meta_data ->> 'full_name');

    return new;
  end if;

  invited_tenant_id := (new.raw_user_meta_data ->> 'tenant_id')::uuid;
  if invited_tenant_id is not null then
    insert into public.profiles (id, tenant_id, role, full_name)
    values (new.id, invited_tenant_id, 'admin', new.raw_user_meta_data ->> 'full_name');

    return new;
  end if;

  -- Existing default behavior, unchanged: auto-create a workspace, signing-up
  -- user becomes its admin. This path is a placeholder for direct signup
  -- (DS-001) -- not the enrollment path, which always sets tenant_id above.
  insert into public.workspaces (name, contract_start_date, contract_end_date)
  values (
    coalesce(new.raw_user_meta_data ->> 'workspace_name', new.email || '''s Workspace'),
    current_date,
    current_date
  )
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
