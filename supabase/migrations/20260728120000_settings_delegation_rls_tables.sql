-- ============================================================================
-- Migration: Settings Edit Delegation -- RLS-Enforced Per-Setting Tables
-- Implements: tb-brokerage-permissions-delegation-001 (theos-registry)
-- Reusable pattern documented at: learn-delegated-permissions-rls-001
-- (theos-playbook)
--
-- Supersedes 20260728110000's write path (app-level canEditSetting() check,
-- then a service-role write to the shared `workspaces` row). That worked but
-- left the database with no independent backstop: sharing_templates and
-- performance lived on the same `workspaces` row as unrelated admin-only
-- columns (contract_end_date, exclusivity_hard_block, ...), and RLS can only
-- discriminate by row, never by column within one row -- so a plain
-- "does a delegation exist" policy on `workspaces` would have let a member
-- delegated for ONE setting write to ALL of them.
--
-- Fix: give each delegatable setting its own table. RLS's natural row
-- granularity then IS setting granularity, and the caller's own scoped
-- client performs the write directly -- no service-role bypass anywhere in
-- this feature. See learn-delegated-permissions-rls-001 before copying this
-- pattern for a new toggle-able setting.
-- ============================================================================

-- Reusable helper -- any future delegatable setting's table calls this
-- directly in its own UPDATE policy instead of re-deriving the
-- "admin OR a matching delegation row" check each time. Mirrors
-- current_tenant_id()/current_role()'s exact security posture (security
-- definer + empty search_path, per ADR-002's SECURITY DEFINER hijacking
-- note) since it reads settings_edit_delegations the same way those read
-- profiles.
create or replace function public.has_settings_delegation(p_setting_key text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    (select public.current_role()) = 'admin'
    or exists (
      select 1 from public.settings_edit_delegations
      where tenant_id = (select public.current_tenant_id())
        and member_id = auth.uid()
        and setting_key = p_setting_key
    );
$$;

grant execute on function public.has_settings_delegation(text) to authenticated;

comment on function public.has_settings_delegation(text) is
  'Reusable RLS building block (tb-brokerage-permissions-delegation-001 / '
  'learn-delegated-permissions-rls-001): true if the caller is an admin, or '
  'holds an explicit settings_edit_delegations grant for p_setting_key. Use '
  'directly in a per-setting table''s own UPDATE policy -- never gate a '
  'multi-setting table with this, only a table scoped to one setting.';

-- ----------------------------------------------------------------------------
-- Sharing Templates -- split out of workspaces
-- ----------------------------------------------------------------------------

create table if not exists public.workspace_sharing_settings (
  tenant_id                uuid primary key references public.workspaces(id),
  public_share_template    text,
  co_broker_share_template text
);

comment on table public.workspace_sharing_settings is
  'One row per tenant. Split out of workspaces (tb-brokerage-permissions-'
  'delegation-001) so RLS can enforce sharing_templates delegation without '
  'also exposing unrelated workspaces columns to a delegated non-admin.';

insert into public.workspace_sharing_settings (tenant_id, public_share_template, co_broker_share_template)
select id, public_share_template, co_broker_share_template from public.workspaces
on conflict (tenant_id) do nothing;

alter table public.workspace_sharing_settings enable row level security;

create policy workspace_sharing_settings_select_tenant on public.workspace_sharing_settings
  for select
  using (tenant_id = (select public.current_tenant_id()));

create policy workspace_sharing_settings_update_delegated on public.workspace_sharing_settings
  for update
  using (tenant_id = (select public.current_tenant_id()) and public.has_settings_delegation('sharing_templates'))
  with check (tenant_id = (select public.current_tenant_id()) and public.has_settings_delegation('sharing_templates'));

grant select, update on public.workspace_sharing_settings to authenticated;
grant all on public.workspace_sharing_settings to service_role;

alter table public.workspaces drop column if exists public_share_template;
alter table public.workspaces drop column if exists co_broker_share_template;

-- ----------------------------------------------------------------------------
-- Performance -- split out of workspaces
-- ----------------------------------------------------------------------------

create table if not exists public.workspace_performance_settings (
  tenant_id           uuid primary key references public.workspaces(id),
  hot_share_threshold integer not null default 3
);

comment on table public.workspace_performance_settings is
  'One row per tenant. Split out of workspaces (tb-brokerage-permissions-'
  'delegation-001) -- see workspace_sharing_settings for why.';

insert into public.workspace_performance_settings (tenant_id, hot_share_threshold)
select id, hot_share_threshold from public.workspaces
on conflict (tenant_id) do nothing;

alter table public.workspace_performance_settings enable row level security;

create policy workspace_performance_settings_select_tenant on public.workspace_performance_settings
  for select
  using (tenant_id = (select public.current_tenant_id()));

create policy workspace_performance_settings_update_delegated on public.workspace_performance_settings
  for update
  using (tenant_id = (select public.current_tenant_id()) and public.has_settings_delegation('performance'))
  with check (tenant_id = (select public.current_tenant_id()) and public.has_settings_delegation('performance'));

grant select, update on public.workspace_performance_settings to authenticated;
grant all on public.workspace_performance_settings to service_role;

alter table public.workspaces drop column if exists hot_share_threshold;

-- ----------------------------------------------------------------------------
-- settings_edit_delegations: admin writes now go through the caller's own
-- scoped client under RLS, not a service-role bypass. Only an admin can
-- create/change/remove a grant, mirroring workspaces_update_admin's shape.
-- ----------------------------------------------------------------------------

create policy settings_edit_delegations_insert_admin on public.settings_edit_delegations
  for insert
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin');

create policy settings_edit_delegations_update_admin on public.settings_edit_delegations
  for update
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin')
  with check (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin');

create policy settings_edit_delegations_delete_admin on public.settings_edit_delegations
  for delete
  using (tenant_id = (select public.current_tenant_id()) and (select public.current_role()) = 'admin');

grant insert, update, delete on public.settings_edit_delegations to authenticated;
