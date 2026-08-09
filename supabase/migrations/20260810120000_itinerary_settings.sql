-- ============================================================================
-- Migration: Itinerary Generation Settings — Recipient, Drive Folder & Template
-- Implements: tb-buyer-leads-itinerary-settings-001 (theos-registry)
--
-- Adds a per-workspace workspace_itinerary_settings row (standing recipient
-- email, target Drive folder ID, template Google Doc ID) that makes
-- tb-buyer-leads-match-itinerary-001's itinerary generation configurable.
-- Same per-setting-table/RLS-delegation pattern as workspace_sharing_settings/
-- workspace_commission_settings — see DD-020.
-- ============================================================================

create table public.workspace_itinerary_settings (
  tenant_id            uuid primary key references public.workspaces(id),
  recipient_email      text,
  drive_folder_id      text,
  template_document_id text,
  updated_at           timestamptz not null default now()
);

comment on table public.workspace_itinerary_settings is
  'One row per tenant. Additive configuration for tb-buyer-leads-match-'
  'itinerary-001''s Google Docs itinerary generation -- any field left null '
  'falls back to that tracer bullet''s original behavior for that piece '
  '(plain-text builder, no folder, agent-only share).';

create trigger trg_workspace_itinerary_settings_updated_at
  before update on public.workspace_itinerary_settings
  for each row execute function public.set_updated_at();

alter table public.workspace_itinerary_settings enable row level security;

create policy workspace_itinerary_settings_select_tenant on public.workspace_itinerary_settings
  for select
  using (tenant_id = (select public.current_tenant_id()));

-- Reuses the existing settings-delegation mechanism (tb-brokerage-permissions-
-- delegation-001), same pattern every other per-setting table already uses.
-- 'itinerary' is a new setting_key (see the widened check constraint below).
create policy workspace_itinerary_settings_update_delegated on public.workspace_itinerary_settings
  for update
  using (tenant_id = (select public.current_tenant_id()) and public.has_settings_delegation('itinerary'))
  with check (tenant_id = (select public.current_tenant_id()) and public.has_settings_delegation('itinerary'));

grant select, update on public.workspace_itinerary_settings to authenticated;
grant all on public.workspace_itinerary_settings to service_role;

-- Widen settings_edit_delegations' setting_key check to allow 'itinerary',
-- same widening every prior new setting_key has done.
alter table public.settings_edit_delegations
  drop constraint settings_edit_delegations_setting_key_check;
alter table public.settings_edit_delegations
  add constraint settings_edit_delegations_setting_key_check
  check (setting_key in ('sharing_templates', 'performance', 'matching', 'tasks', 'commission', 'itinerary'));

-- Extend the auto-provisioning trigger (20260728171500) to also seed a
-- default workspace_itinerary_settings row for every tenant -- "add new
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
  insert into public.workspace_itinerary_settings (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  return new;
end;
$$;

comment on function public.provision_workspace_settings_defaults() is
  'Fires after every workspaces insert -- seeds a default row in every '
  'per-tenant settings table (workspace_sharing_settings, '
  'workspace_performance_settings, workspace_matching_settings, '
  'workspace_commission_settings, workspace_itinerary_settings) so no '
  'Settings sub-panel 500s for a freshly created tenant. Add new settings '
  'tables here, not to individual insert call sites.';

-- Backfill: every tenant that already existed before this migration.
insert into public.workspace_itinerary_settings (tenant_id)
select id from public.workspaces
on conflict (tenant_id) do nothing;
