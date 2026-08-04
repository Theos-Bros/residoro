-- ============================================================================
-- Migration: Commission Structure & Computed Earnings
-- Implements: tb-commission-structure-001 (theos-registry)
--
-- Adds a per-workspace default commission split (workspace_commission_settings)
-- and a real, snapshotted earnings record (commission_earnings) computed from
-- a manually-entered total commission against a completed Closing.
-- ============================================================================

-- Singleton per-tenant settings row, same shape as workspace_matching_settings
-- (DD not yet written for that one) / workspace_performance_settings.
create table public.workspace_commission_settings (
  tenant_id              uuid primary key references public.workspaces(id),
  default_brokerage_pct  numeric not null default 50,
  default_agent_pct      numeric not null default 50,
  default_co_broker_pct  numeric not null default 0,
  updated_at             timestamptz not null default now(),
  -- The three shares must always account for the whole commission -- DB-level
  -- enforcement rather than trusting every write path to get the math right,
  -- same reasoning tb-brokerage-permissions-admin-uniqueness-001 gave for
  -- moving an app-only invariant to a real constraint.
  constraint workspace_commission_settings_pct_sum_100
    check (default_brokerage_pct + default_agent_pct + default_co_broker_pct = 100)
);

create trigger trg_workspace_commission_settings_updated_at
  before update on public.workspace_commission_settings
  for each row execute function public.set_updated_at();

alter table public.workspace_commission_settings enable row level security;

create policy workspace_commission_settings_select_tenant on public.workspace_commission_settings
  for select
  using (tenant_id = (select public.current_tenant_id()));

-- Reuses the existing settings-delegation mechanism (tb-brokerage-permissions-
-- delegation-001) rather than a hand-rolled admin check -- same pattern
-- workspace_matching_settings/workspace_task_routing_settings already
-- established. 'commission' is a new setting_key (see the widened check
-- constraint on settings_edit_delegations below).
create policy workspace_commission_settings_update_delegated on public.workspace_commission_settings
  for update
  using (tenant_id = (select public.current_tenant_id()) and public.has_settings_delegation('commission'))
  with check (tenant_id = (select public.current_tenant_id()) and public.has_settings_delegation('commission'));

grant select, update on public.workspace_commission_settings to authenticated;
grant all on public.workspace_commission_settings to service_role;

-- Widen settings_edit_delegations' setting_key check to allow 'commission',
-- same widening tb-buyer-leads-matching-001/tb-tasks-crud-001 each did for
-- their own new setting_key.
alter table public.settings_edit_delegations
  drop constraint settings_edit_delegations_setting_key_check;
alter table public.settings_edit_delegations
  add constraint settings_edit_delegations_setting_key_check
  check (setting_key in ('sharing_templates', 'performance', 'matching', 'tasks', 'commission'));

-- Extend the auto-provisioning trigger (20260728171500) to also seed a
-- default workspace_commission_settings row for every tenant -- "add new
-- settings tables here, not to individual insert call sites," per that
-- migration's own comment.
create or replace function public.provision_workspace_settings_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_sharing_settings (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  insert into public.workspace_performance_settings (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  insert into public.workspace_matching_settings (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  insert into public.workspace_commission_settings (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  return new;
end;
$$;

comment on function public.provision_workspace_settings_defaults() is
  'Fires after every workspaces insert -- seeds a default row in every '
  'per-tenant settings table (workspace_sharing_settings, '
  'workspace_performance_settings, workspace_matching_settings, '
  'workspace_commission_settings) so no Settings sub-panel 500s for a '
  'freshly created tenant. Add new settings tables here, not to individual '
  'insert call sites.';

-- Backfill: every tenant that already existed before this migration.
insert into public.workspace_commission_settings (tenant_id)
select id from public.workspaces
on conflict (tenant_id) do nothing;

-- ----------------------------------------------------------------------------
-- commission_earnings: a snapshotted, immutable-once-created record. One per
-- Closing (unique constraint) -- total_commission is manually entered per
-- deal (confirmed with the user: some deals negotiate a flat fee, not a
-- price-derived %), then split brokerage/agent/co-broker using whichever
-- workspace_commission_settings percentages are current AT ENTRY TIME,
-- snapshotted onto the row so a later settings change never alters it.
-- ----------------------------------------------------------------------------

create table public.commission_earnings (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.workspaces(id),
  closing_id        uuid not null references public.closings(id),

  total_commission  numeric not null,
  currency          text not null default 'PHP',

  brokerage_pct     numeric not null,
  agent_pct         numeric not null,
  co_broker_pct     numeric not null,
  brokerage_amount  numeric not null,
  agent_amount      numeric not null,
  co_broker_amount  numeric not null,

  computed_at       timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);

create unique index idx_commission_earnings_closing_id on public.commission_earnings (closing_id);
create index idx_commission_earnings_tenant_id on public.commission_earnings (tenant_id);

-- RLS: tenant-scoped CRUD, same shape as offers/contracts/closings -- a
-- transactional record open to any tenant member (confirmed with the user:
-- everyone can view; recording one follows this codebase's established
-- transactional-record precedent, not the settings-record admin-only one).
alter table public.commission_earnings enable row level security;

create policy commission_earnings_select_tenant on public.commission_earnings for select
  using (tenant_id = public.current_tenant_id());
create policy commission_earnings_insert_tenant on public.commission_earnings for insert
  with check (tenant_id = public.current_tenant_id());
create policy commission_earnings_update_tenant on public.commission_earnings for update
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
create policy commission_earnings_delete_tenant on public.commission_earnings for delete
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete on public.commission_earnings to authenticated;
grant all on public.commission_earnings to service_role;
