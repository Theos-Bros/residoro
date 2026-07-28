-- ============================================================================
-- Migration: Buyer Leads Matching -- Settings Table + last_searched_at
-- Implements: tb-buyer-leads-matching-001 (theos-registry)
--
-- match_score_threshold follows the delegated-settings pattern established by
-- 20260728120000_settings_delegation_rls_tables.sql (learn-delegated-
-- permissions-rls-001) -- its own table, RLS via has_settings_delegation(),
-- NOT a plain column on workspaces (that pattern was already superseded
-- before this tracer bullet started; workspace_performance_settings is the
-- current live shape for hot_share_threshold, and this mirrors it exactly).
-- ============================================================================

create table if not exists public.workspace_matching_settings (
  tenant_id            uuid primary key references public.workspaces(id),
  match_score_threshold integer not null default 50
    check (match_score_threshold between 0 and 100)
);

comment on table public.workspace_matching_settings is
  'One row per tenant. Mirrors workspace_performance_settings'' shape '
  '(tb-buyer-leads-matching-001) -- match_score_threshold is the cutoff a '
  'search result needs to clear to count as a "good match".';

insert into public.workspace_matching_settings (tenant_id, match_score_threshold)
select id, 50 from public.workspaces
on conflict (tenant_id) do nothing;

alter table public.workspace_matching_settings enable row level security;

create policy workspace_matching_settings_select_tenant on public.workspace_matching_settings
  for select
  using (tenant_id = (select public.current_tenant_id()));

create policy workspace_matching_settings_update_delegated on public.workspace_matching_settings
  for update
  using (tenant_id = (select public.current_tenant_id()) and public.has_settings_delegation('matching'))
  with check (tenant_id = (select public.current_tenant_id()) and public.has_settings_delegation('matching'));

grant select, update on public.workspace_matching_settings to authenticated;
grant all on public.workspace_matching_settings to service_role;

-- Widen settings_edit_delegations' setting_key check constraint to allow the
-- new 'matching' key, per tb-brokerage-permissions-delegation-001's own
-- semantic_scope note that a future Settings sub-section's tracer bullet
-- extends it.
alter table public.settings_edit_delegations
  drop constraint settings_edit_delegations_setting_key_check;

alter table public.settings_edit_delegations
  add constraint settings_edit_delegations_setting_key_check
  check (setting_key in ('sharing_templates', 'performance', 'matching'));

-- tb-buyer-leads-matching-001: set by the new search endpoint; symmetric with
-- buyer_requirements.last_searched_at (added in tb-buyer-leads-schema-001,
-- unused until now).
alter table public.inquiries
  add column if not exists last_searched_at timestamptz;
